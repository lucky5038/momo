// 纯函数回归：表头合并必须聚合去重，不能退化成 UPDATE JOIN。
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
assert.ok(built.updateSql.includes('_momo_src'), '应先生成来源集合');
assert.ok(built.updateSql.includes('_momo_agg'), '应按目标主键聚合');
assert.ok(built.updateSql.includes('FOR XML PATH'), '应兼容 SQL Server 的字符串聚合');
assert.ok(built.updateSql.includes('GROUP BY _k0, _k1'), '应按目标主键分组');
assert.ok(built.updateSql.includes('RBB001] = [b].[RBA001]'), '头身关联应带类别');
const trig = sqlgen.buildTriggerFromStatements('SGMRBA', 'trg_SGMRBA_momo', [
  sqlgen.applyInsertedFilter(built.updateSql, 'i.[RBA001]=b.[RBA001] AND i.[RBA002]=b.[RBA002]')
]);
assert.ok(trig.includes('EXISTS (SELECT 1 FROM inserted i'), '触发器应只处理 inserted 单头');
assert.strictEqual((trig.match(/DECLARE\s+@momo_msg/gi) || []).length, 1, '只允许一个 @momo_msg');
const lineBuilt = sqlgen.buildChainMergeSQL('SGMRBA', 'RBA961', 'DEA002', 'fill', true, path, docs, ['RBA001', 'RBA002'], '   ', 'i.[RBB001]=b.[RBA001] AND i.[RBB002]=b.[RBA002]');
const lineTrig = sqlgen.buildTriggerFromStatements('SGMRBB', 'trg_SGMRBB_header_momo', [lineBuilt.updateSql]);
assert.ok(lineTrig.includes('ON [dbo].[SGMRBB] AFTER INSERT'), '触发器应挂在领料单身');
assert.ok(lineTrig.includes('EXISTS (SELECT 1 FROM inserted i WHERE i.[RBB001]=b.[RBA001]'), '触发器应只处理 inserted 单身对应的单头');
console.log('PASS 表头合并聚合去重，触发器复用聚合 SQL');
