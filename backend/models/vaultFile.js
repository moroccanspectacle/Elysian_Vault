const {DataTypes} = require('sequelize');
const sequelize = require('../config/database');
const User = require('./User');
const File = require('./File');
const bcrypt = require('bcryptjs'); // Import bcrypt

const VaultFile = sequelize.define('VaultFile', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    }, 
    fileId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: File,
            key: 'id',
        }
    },
    userId: {
        type: DataTypes.INTEGER,  // Change from UUID to INTEGER
        allowNull: false, 
        references: {
            model: User,
            key: 'id',
        }
    },
    vaultKey: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    accessCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
    },
    lastAccessed: {
        type: DataTypes.DATE, 
        allowNull: true,
    },
    selfDestruct: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    destructAfter: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    accessPin: {
        type: DataTypes.STRING,
        allowNull: true, // Allow null initially, will be set when added
    },
}, {
    hooks: {
        // Hash the pin before saving
        beforeCreate: async (vaultFile) => {
            if (vaultFile.accessPin) {
                const salt = await bcrypt.genSalt(10);
                vaultFile.accessPin = await bcrypt.hash(vaultFile.accessPin, salt);
            }
        },
        // Optional: Hash if updated (though PIN shouldn't change often)
        beforeUpdate: async (vaultFile) => {
            if (vaultFile.changed('accessPin') && vaultFile.accessPin) {
                const salt = await bcrypt.genSalt(10);
                vaultFile.accessPin = await bcrypt.hash(vaultFile.accessPin, salt);
            }
        }
    }
});


VaultFile.belongsTo(File, { foreignKey: 'fileId' });
File.hasOne(VaultFile, { foreignKey: 'fileId' }); 

module.exports = VaultFile;