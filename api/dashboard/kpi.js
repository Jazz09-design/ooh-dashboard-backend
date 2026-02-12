const applyCors = require("../_cors");
const { getKpi } = require("../../controllers/kpi.controller");

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  return getKpi(req, res);
};
