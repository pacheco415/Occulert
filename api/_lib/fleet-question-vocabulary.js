// A standalone domain word can describe the fleet even if a driver shares it.
const fleetQuestionWords = new Set((
  'driver drivers fleet shift shifts rest break breaks early late morning afternoon evening night weekend weekdays ' +
  'week month day days alert alerts session sessions miles hours long most best average trend trends time price ' +
  'young rich will may june mark chase grant hope grace bill park lane west east north south'
).split(' '));

module.exports = { fleetQuestionWords };
