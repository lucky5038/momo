// 数据库连接配置。可在工具界面的「数据库连接」区修改并保存，
// 也可手动编辑本文件后重启工具。
module.exports = {
  db: {
    server: "192.168.31.156",
    user: "sa",
    password: "123",
    database: "DSB",
    options: { encrypt: false, trustServerCertificate: true, instanceName: null }
  },
  backupDir: "D:\\TPA\\SQL2008",
  httpPort: 8787
};