const applyCors = require("../_cors");
const { getTraffic } = require("../../controllers/traffic.controller");

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  return getTraffic(req, res);
};
