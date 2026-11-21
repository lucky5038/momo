// 纯函数回归：表头合并必须聚合去重，并保留目标已有值。
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
const built = sqlgen.buildChainMergeSQL('SGMRBA', 'RBA961', 'DEA002', 'fill', true, path, docs, ['RBA001', 'RBA002'], '   ');
assert.ok(built.isHeaderMerge, '应标记为表头合并');
assert.ok(built.updateSql.includes('_nb_src'), '应先生成来源集合');
assert.ok(built.updateSql.includes('_nb_agg'), '应按目标主键聚合');
assert.ok(built.updateSql.includes('FOR XML PATH'), '应兼容 SQL Server 的字符串聚合');
assert.ok(built.updateSql.includes('GROUP BY _k0, _k1'), '应按目标主键分组');
assert.ok(built.updateSql.includes('RBB001] = [b].[RBA001]'), '头身关联应带类别');
assert.ok(built.updateSql.includes('CHARINDEX'), '应排除目标已有值，避免重复追加');
const trig = sqlgen.buildTriggerFromStatements('SGMRBA', 'trg_SGMRBA_nb', [built.updateSql]);
assert.ok(trig.includes('ON [dbo].[SGMRBA] AFTER INSERT'), '触发器应挂在目标表');
assert.strictEqual((trig.match(/DECLARE\s+@nb_msg/gi) || []).length, 1, '只允许一个 @nb_msg');
console.log('PASS 表头合并聚合去重、保留旧值，触发器复用聚合 SQL');
