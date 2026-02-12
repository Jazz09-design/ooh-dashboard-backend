const applyCors = require("../_cors");
const { getDemography } = require("../../controllers/demography.controller");

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  return getDemography(req, res);
};
