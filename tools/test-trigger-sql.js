// 纯函数级回归：兜底通道（前置优先_计划兜底）的触发器 SQL 必须由该通道的 UPDATE SQL 派生。
// 不连接数据库，只验证 SQL 形状，防止再次出现"触发器里另写一套硬编码表名"。
'use strict';

const assert = require('assert');
const makeSqlgen = require('../source/src/sqlgen');

const sqlgen = makeSqlgen({});

const docs = [{
  id: 'SGMRAA', sub: 'SGMRAA', name: '工单',
  keyCol: 'RAA001', refCol: 'RAA026', prefCol: 'RAA011',
  seqCol: null, colNo: 'RAA001', colSeq: 'RAA002',
  main: 'SGMRA0', mainKeyCol: 'RAA001', partyCol: null
}];
const srcs = [{ id: 'DCSIBA', key: ['IBA001'], seqKey: null, party: 'none' }];

const built = sqlgen.buildSQL('SGMRAA', 'RAA099', 'DCSIBA', 'IBA003', undefined, 'fill', false, null, { docs, srcs });

assert.strictEqual(built.channelName, '前置优先_计划兜底', '应命中计划兜底通道');
assert.ok(built.isFallback, '应标记为兜底通道');
assert.ok(built.updateSql.includes('FROM [dbo].[SGMRAA] b'), 'UPDATE 应基于工单表');
assert.ok(built.updateSql.includes('LEFT JOIN [dbo].[SGMRIB] s2 ON s2.RIB001 = b.RAA026'), 'UPDATE 应包含计划档兜底 JOIN');

const trigSql = sqlgen.buildTriggerFromStatements('SGMRAA', 'trg_SGMRAA_nb', [
  sqlgen.applyInsertedFilter(built.updateSql, 'i.[RAA001]=b.[RAA001]')
]);

assert.ok(trigSql.startsWith('CREATE TRIGGER [dbo].[trg_SGMRAA_nb] ON [dbo].[SGMRAA] AFTER INSERT'), '触发器头不正确');
assert.ok(trigSql.includes('SET XACT_ABORT ON'), '缺少 XACT_ABORT');
assert.ok(trigSql.includes('WHERE EXISTS (SELECT 1 FROM inserted i WHERE i.[RAA001]=b.[RAA001])'), '缺少 inserted 过滤');
assert.ok(trigSql.includes('LEFT JOIN [dbo].[SGMRIB] s2 ON s2.RIB001 = b.RAA026'), '触发器应复用 UPDATE 的计划档 JOIN');
assert.ok(trigSql.includes('b.[RAA099]'), '触发器应写目标列');
assert.ok(!trigSql.includes('JOIN inserted i ON'), '不应再使用旧的手写 inserted JOIN 形式');
assert.ok(/END;\s*$/.test(trigSql), '触发器应以 END; 结束');

console.log('PASS 兜底通道触发器由 UPDATE SQL 派生，无手写表名');
