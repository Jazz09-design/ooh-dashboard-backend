const applyCors = require("../_cors");
const { getOverview } = require("../../controllers/overview.controller");

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  return getOverview(req, res);
};
