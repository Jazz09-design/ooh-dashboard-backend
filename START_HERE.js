const express = require("express");
const app = express();

app.get("/ping", (req, res) => {
  res.json({ ok: true, port: 3000 });
});

app.listen(3000, () => {
  console.log(" TEST SERVER RUNNING ON PORT 3000");
});
