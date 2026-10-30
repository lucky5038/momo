// 纯函数回归：合并两个带 TRY/CATCH 的工具触发器时，只能保留一层包装和一个 @momo_msg。
'use strict';
const assert = require('assert');
const makeSqlgen = require('../source/src/sqlgen');
const sqlgen = makeSqlgen({});

const u1 = "UPDATE b SET b.[RBB960]=s.[RAB004] FROM [dbo].[SGMRBB] b JOIN [dbo].[SGMRAB] s ON s.[RAB001]=b.[RBB010] AND s.[RAB002]=b.[RBB011] WHERE (b.[RBB960] IS NULL)";
const u2 = "UPDATE b SET b.[RBB022]=s.[RAB020] FROM [dbo].[SGMRBB] b JOIN [dbo].[SGMRAB] s ON s.[RAB001]=b.[RBB010] AND s.[RAB002]=b.[RBB011] WHERE (b.[RBB022] IS NULL)";

const oldSql = sqlgen.buildTriggerFromStatements('SGMRBB', 'trg_SGMRBB_momo', [u1], 'SGMRBB.RBB960');
const newSql = sqlgen.buildTriggerFromStatements('SGMRBB', 'trg_SGMRBB_momo', [u2], 'SGMRBB.RBB022');
const merged = sqlgen.mergeTriggerDefinitions('SGMRBB', 'trg_SGMRBB_momo', [
  { name: 'trg_SGMRBB_momo', sql: oldSql }
], newSql, { replaceTargets: ['RBB022'] });

const declares = (merged.match(/DECLARE\s+@momo_msg/gi) || []).length;
const tries = (merged.match(/BEGIN\s+TRY/gi) || []).length;
const catches = (merged.match(/BEGIN\s+CATCH/gi) || []).length;

assert.strictEqual(declares, 1, '只能声明一次 @momo_msg，实际 ' + declares);
assert.strictEqual(tries, 1, '只能有一层 TRY，实际 ' + tries);
assert.strictEqual(catches, 1, '只能有一层 CATCH，实际 ' + catches);
assert.ok(merged.includes('b.[RBB960]'), '合并后应保留旧字段 RBB960');
assert.ok(merged.includes('b.[RBB022]'), '合并后应加入新字段 RBB022');
assert.ok(!/END\s+TRY[\s\S]*BEGIN\s+TRY/i.test(merged), '不应出现嵌套 TRY');
assert.ok(/END;\s*$/.test(merged), '触发器应以 END; 结束');

console.log('PASS 触发器合并只保留一层 TRY/CATCH 和一个 @momo_msg');
