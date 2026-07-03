module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Required for react-native-vision-camera frame processors
      'react-native-worklets-core/plugin',
    ],
  };
};
