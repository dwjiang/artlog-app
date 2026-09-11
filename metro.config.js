const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('db', 'txt');
config.resolver.sourceExts.push('sql');

module.exports = config;
