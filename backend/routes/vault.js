const router = require('express').Router();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const verifyToken = require('./verifyToken');
const {logActivity} = require('../services/logger');
const File = require('../models/File');
const VaultFile = require('../models/vaultFile');
const User = require('../models/User');
const SystemSettings = require('../models/SystemSettings');
const Department = require('../models/Department');
const {generateFileHash} = require('../config/fileIntegrity');
const bcrypt = require('bcryptjs');


// POST /add route
router.post('/add/:fileId', verifyToken,async (req, res) => {
    try {
        const fileId = req.params.fileId;
        const userId = req.user.id;
        const { pin } = req.body;

        
        if (!pin || !/^\d{6}$/.test(pin)) {
            return res.status(400).json({ message: 'A 6-digit PIN is required' });
        }
        

        const file = await File.findOne({
            where: {
                id: fileId,
                userId: userId,
                isDeleted: false, 
            }
        });
        if (!file) {
            return res.status(404).json({message: 'File not found'});
        }

        const existingVaultFile = await VaultFile.findOne({
            where: {fileId: fileId}
        });
        if (existingVaultFile) {
            return res.status(400).json({message: 'File already in vault'});
        }
        
        // Check vault permissions and quota
        const permissionCheck = await checkVaultPermissions(userId, file.fileSize);
        if (!permissionCheck.allowed) {
            return res.status(403).json({
                message: permissionCheck.error,
                quota: permissionCheck.quota,
                usage: permissionCheck.usage,
                remaining: permissionCheck.remaining
            });
        }

        // Vault key generation
        const additionalKey = crypto.randomBytes(16).toString('hex');
        const encryptedKey = crypto.createHmac('sha256', process.env.TOKEN_SECRET + userId)
            .update(additionalKey)
            .digest('hex');

        const vaultFile = await VaultFile.create({
            fileId: fileId,
            userId: userId,
            vaultKey: encryptedKey,
            accessPin: pin,
            lastAccessed: null,
            selfDestruct: req.body.selfDestruct || false,
            destructAfter: req.body.destructAfter || null,
        });
        
        // Update user's vault usage
        await User.increment('vaultUsage', {
            by: file.fileSize,
            where: { id: userId }
        });

        await logActivity('vault_add', userId, fileId, 'Added file to vault', req);
        
        // Return quota information
        const updatedPermissions = await checkVaultPermissions(userId);
        
        res.status(201).json({
            message: 'File added to vault successfully',
            vaultFileId: vaultFile.id,
            quota: updatedPermissions.quota,
            usage: updatedPermissions.usage,
            remaining: updatedPermissions.remaining
        });
    } catch (error) {
        console.error('Error adding file to vault:', error);
        res.status(500).json({message: 'Failed to add file to vault'});
    }
});

router.get('/list', verifyToken, async (req, res) => {
    try {
        const userId = req.user.id;
        console.log(`[Vault List] Fetching vault files for user: ${userId}`);

        const vaultFiles = await VaultFile.findAll({
            where: {userId: userId},
            include: [{
                model: File,
                required: true, 
                where: { isDeleted: false }, 
                attributes: ['id', 'originalName', 'fileSize', 'fileType', 'uploadDate']
            }]
        });

        console.log(`[Vault List] Found ${vaultFiles.length} raw vault file records.`);

        const mappedFiles = vaultFiles.map(vf => ({
            id: vf.id,
            fileId: vf.fileId,
            fileName: vf.File.originalName, 
            fileSize: vf.File.fileSize,
            fileType: vf.File.fileType,
            uploadDate: vf.File.uploadDate,
            lastAccessed: vf.lastAccessed,
            requiresMfa: vf.requireMfa,
            selfDestruct: vf.selfDestruct,
            destructAfter: vf.destructAfter
        }));

        console.log(`[Vault List] Mapped ${mappedFiles.length} files to send.`); // Log mapped count

        res.json(mappedFiles); // Send the mapped data

    } catch (error) {
        console.error('[Vault List] Error listing vault files:', error);
        res.status(500).json({message: 'Failed to list vault files'});
    }
});

// GET /access route
router.get('/access/:id', verifyToken, async (req, res) => {
    try {
        const vaultFileId = req.params.id;
        const userId = req.user.id;
        // Try reading lowercase header name first
        let providedPin = req.headers['x-vault-pin'];

        console.log(`[Vault Access] Checking for PIN header 'x-vault-pin' (lowercase). Found: ${providedPin ? 'Yes' : 'No'}`);

        // try uppercase again
        if (!providedPin) {
            providedPin = req.headers['X-Vault-PIN'];
            console.log(`[Vault Access] Checking for PIN header 'X-Vault-PIN' (uppercase). Found: ${providedPin ? 'Yes' : 'No'}`);
        }

        // log all headers
        if (!providedPin) {
            console.log('[Vault Access] All headers received by route handler:', JSON.stringify(req.headers, null, 2));
        }

        
        if (!providedPin) {
            console.error('[Vault Access] Error: Vault PIN header was missing.'); // Log the specific failure
            return res.status(401).json({ message: 'Vault PIN required', needsPin: true });
        }

        const vaultFile = await VaultFile.findOne({
            where: {
                id: vaultFileId,
                userId: userId,
            },
            include: [{
                model: File,
                where: {isDeleted: false},
            }]
        });
        if (!vaultFile) {
            return res.status(404).json({message: 'Vault file not found'});
        }

        // Verify PIN Hash
        if (!vaultFile.accessPin) {
             console.error(`Vault file ${vaultFileId} is missing access PIN hash.`);
             return res.status(500).json({ message: 'Internal error: Vault file configuration issue.' });
        }
        const pinIsValid = await bcrypt.compare(providedPin, vaultFile.accessPin);
        if (!pinIsValid) {
            return res.status(403).json({ message: 'Invalid Vault PIN', needsPin: true });
        }
        


        // Self-destruct logic
        if (vaultFile.selfDestruct && vaultFile.destructAfter && new Date() > new Date(vaultFile.destructAfter)) {
            await vaultFile.File.update({isDeleted: true});
            await vaultFile.destroy();
            return res.status(410).json({message: 'File has been deleted due to self-destruct'});
        }

        // Update access count/time
        await vaultFile.update({
            accessCount: vaultFile.accessCount + 1,
            lastAccessed: new Date(),
        });
        await logActivity('vault_access', userId, vaultFile.fileId, 'Accessed file from vault', req);

        // Return file info
        const file = vaultFile.File;
        res.json({
            id: file.id,
            fileId: file.id,
            fileName: file.originalName,
            fileSize: file.fileSize,
            fileType: file.fileType,
            uploadDate: file.uploadDate,
            accessCount: vaultFile.accessCount,
            lastAccessed: vaultFile.lastAccessed,
        })

    } catch (error) {
        console.error('[Vault Access] Error:', error);
        res.status(500).json({message: 'Failed to access vault file'});
    }
});

router.delete('/:id', verifyToken, async (req, res) => {
    try {
        const vaultFileId = req.params.id;
        const userId = req.user.id;

        const vaultFile = await VaultFile.findOne({
            where:{
                id: vaultFileId,
                userId: userId,
            },
            include: [{
                model: File
            }]
        });
        
        if (!vaultFile) {
            return res.status(404).json({message: 'Vault file not found'});
        }
        
        const fileId = vaultFile.fileId;
        const fileSize = vaultFile.File.fileSize;
        
        // Reduce user's vault usage
        await User.decrement('vaultUsage', {
            by: fileSize,
            where: { id: userId }
        });

        await vaultFile.destroy();
        await logActivity('vault_remove', userId, fileId, 'removed file from vault', req);
        
        // Return updated quota information
        const updatedPermissions = await checkVaultPermissions(userId);
        
        res.json({
            message: 'File removed from vault successfully',
            quota: updatedPermissions.quota,
            usage: updatedPermissions.usage,
            remaining: updatedPermissions.remaining
        });
    } catch (error) {
        console.error('Error removing file from vault:', error);
        res.status(500).json({message: 'Failed to remove file from vault'});
    }
});

router.get('/permissions', verifyToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const permissionInfo = await checkVaultPermissions(userId);
        if (!permissionInfo.allowed) {
            return res.status(403).json({message: permissionInfo.error});
        }
        res.json({
            hasAccess: true,
            quota: permissionInfo.quota,
            usage: permissionInfo.usage,
            remaining: permissionInfo.remaining,
            unlimited: permissionInfo.quota === -1
        });
    } catch (error) {
        console.error('Error getting vault permissions:', error);
        res.status(500).json({message: 'Failed to get vault permissions'});
    }
});

// Helper function to check vault permissions and quotas
async function checkVaultPermissions(userId, fileSize = 0) {
  try {
    // Get user with their department info
    const user = await User.findByPk(userId, {
      attributes: ['id', 'role', 'departmentId', 'vaultAccess', 'vaultQuota', 'vaultUsage'],
      include: [{ model: Department, attributes: ['vaultAccess', 'vaultQuotaBonus', 'requireMfa'] }] // Now Department is defined
    });
    
    if (!user) {
      return { allowed: false, error: 'User not found' };
    }
    
    // If user's vault access is explicitly revoked
    if (user.vaultAccess === false) {
      console.log(`Vault access denied for user ${userId}: User vaultAccess is false.`); // Add log
      return { allowed: false, error: 'Vault access has been revoked for your account' };
    }
    
    // If department's vault access is revoked
    if (user.Department && user.Department.vaultAccess === false) {
      console.log(`Vault access denied for user ${userId}: Department ${user.departmentId} vaultAccess is false.`); // Add log
      return { allowed: false, error: 'Vault access has been revoked for your department' };
    }
    
    // Get system-wide vault settings
    const systemSettings = await SystemSettings.findOne({ where: { id: 1 } });
    const vaultPermissions = systemSettings?.vaultPermissions || {
      quotas: { user: 1073741824 } // Default 1GB
    };
    
    // Calculate effective quota based on role and department
    let effectiveQuota = user.vaultQuota;
    
    // If system settings define a larger quota for this role
    if (vaultPermissions.quotas[user.role] && 
        (vaultPermissions.quotas[user.role] > effectiveQuota || 
         vaultPermissions.quotas[user.role] === -1)) {
      effectiveQuota = vaultPermissions.quotas[user.role];
    }
    
    // Add department bonus if applicable
    if (user.Department && user.Department.vaultQuotaBonus > 0) {
      if (effectiveQuota !== -1) {
        effectiveQuota = Number(effectiveQuota) + Number(user.Department.vaultQuotaBonus); 
      }
    }

   
    console.log(`[Vault Check] User ${userId}: Usage=${user.vaultUsage}, FileSize=${fileSize}, Calculated Quota=${effectiveQuota}`);

    // Check if adding this file would exceed quota
    if (effectiveQuota !== -1 && user.vaultUsage + fileSize > effectiveQuota) {
      console.log(`Vault access denied for user ${userId}: Quota exceeded. Usage: ${user.vaultUsage}, FileSize: ${fileSize}, Quota: ${effectiveQuota}`); // Add log
      return { 
        allowed: false, 
        error: 'Vault quota exceeded',
        quota: effectiveQuota,
        usage: user.vaultUsage,
        remaining: effectiveQuota - user.vaultUsage,
        requireMfa: user.Department?.requireMfa || false
      };
    }
    
    return { 
      allowed: true,
      quota: effectiveQuota,
      usage: user.vaultUsage,
      remaining: effectiveQuota === -1 ? -1 : effectiveQuota - user.vaultUsage,
    };
  } catch (error) {
    console.error('Error checking vault permissions:', error);
    return { allowed: false, error: 'Failed to check vault permissions' };
  }
}


module.exports = router;