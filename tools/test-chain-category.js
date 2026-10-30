// 纯函数回归：头身内部关联必须带类别，避免同单号不同类别混行。
'use strict';
const assert = require('assert');
const makeSqlgen = require('../source/src/sqlgen');
const sqlgen = makeSqlgen({});

const docs = {
  SGMRBA: { docNo: 'RBA002', docSeq: null, typeCol: 'RBA001', rows: 1 },
  SGMRBB: { docNo: 'RBB002', docSeq: 'RBB003', typeCol: 'RBB001', rows: 1 },
  TPADEA: { docNo: 'DEA001', docSeq: null, typeCol: null, rows: 1 }
};
const path = [
  { from: 'SGMRBA', to: 'SGMRBB', internal: true },
  { from: 'SGMRBB', to: 'TPADEA', fromNo: 'RBB010', toJoinCol: 'DEA001' }
];
const built = sqlgen.buildChainSQL('SGMRBA', 'RBA961', 'DEA002', 'fill', true, path, docs);
assert.ok(built.updateSql.includes('[s1].[RBB002] = [b].[RBA002]'), '应保留单号关联');
assert.ok(built.updateSql.includes('[s1].[RBB001] = [b].[RBA001]'), '头身关联必须带类别');
assert.ok(built.updateSql.includes('[s2].[DEA001] = [s1].[RBB010]'), '主档关联应保留');
console.log('PASS 头身内部关联包含类别过滤');
