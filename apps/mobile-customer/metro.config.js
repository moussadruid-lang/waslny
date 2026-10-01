// Expo SDK 52 auto-configures npm-workspace monorepos (watches packages/mobile-core).
const { getDefaultConfig } = require('expo/metro-config');
module.exports = getDefaultConfig(__dirname);
