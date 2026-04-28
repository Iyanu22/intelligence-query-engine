require("dotenv").config();
const { pool } = require("./database");

pool.query("UPDATE users SET role='admin' WHERE username='Iyanu22'").then(r => {
  console.log("Updated:", r.rowCount, "rows");
  pool.end();
});