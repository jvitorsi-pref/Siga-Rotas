const { getDefaultConfig } = require('expo/metro-config');

const path = require('node:path');
const config = getDefaultConfig(__dirname);
// Os adaptadores nativos reexportam o núcleo funcional na raiz.
config.watchFolders = [path.resolve(__dirname, '..')];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];

module.exports = config;
