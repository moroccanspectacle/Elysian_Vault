const {DataTypes} = require('sequelize');
const sequelize = require('../config/database');
const File = require('./File');
const User = require('./User');

const FileShare = sequelize.define('FileShare', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    shareToken: {
        type: DataTypes.STRING,
        allowNull: false, 
        unique: true
    },
    expiresAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    permissions: {
        type: DataTypes.JSONB,
        defaultValue: {
            canView: true,
            canEdit: false, 
            canDownload: false
        }
    },
    recipientEmail: {
        type: DataTypes.STRING,
        allowNull: true
    },
    isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    }, 
    accessCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    }, 
    fileId: {
        type: DataTypes.UUID,
        references: {
            model: File,
            key: 'id'
        }
    },
    createdById: {
        type: DataTypes.INTEGER,
        references: {
            model: User,
            key: 'id'
        }
    }
});


FileShare.belongsTo(File, {
  foreignKey: 'fileId', 
  onDelete: 'CASCADE'
});

File.hasMany(FileShare, {
  foreignKey: 'fileId', 
  onDelete: 'CASCADE'
});


FileShare.belongsTo(User, { 
  foreignKey: 'createdById' 
});

User.hasMany(FileShare, { 
  foreignKey: 'createdById' 
});

module.exports = FileShare;