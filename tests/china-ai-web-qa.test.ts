import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isLikelyPromptTemplateOrPlaceholder,
  cleanAiAnswerText,
  PLATFORMS,
  NON_ANSWER_EXCLUDE_SELECTORS,
} from '../src/crawler/platforms/china_ai_web_qa';

test('isLikelyPromptTemplateOrPlaceholder correctly flags drawing prompt samples', () => {
  const badPrompt = 'a cat wearing sunglasses, sitting on a beach, cyberpunk style, neon lights, 8k, highly detailed --ar 16:9';
  assert.equal(isLikelyPromptTemplateOrPlaceholder(badPrompt), true);

  const emptyText = '';
  assert.equal(isLikelyPromptTemplateOrPlaceholder(emptyText), true);

  const shortText = 'abc';
  assert.equal(isLikelyPromptTemplateOrPlaceholder(shortText), true);

  const normalAnswer = 'AIGC 领域薪资水平整体较高。算法工程师平均月薪在 35k-60k 之间，产品经理与运营岗位在 20k-40k 之间。';
  assert.equal(isLikelyPromptTemplateOrPlaceholder(normalAnswer), false);

  const tableAnswer = `| 岗位 | 薪资范围 |\n| --- | --- |\n| AI 算法工程师 | 30k-50k |\n| AIGC 产品经理 | 25k-40k |`;
  assert.equal(isLikelyPromptTemplateOrPlaceholder(tableAnswer), false);

  const userQuestionEcho = 'AI岗位的薪资怎么样';
  assert.equal(isLikelyPromptTemplateOrPlaceholder(userQuestionEcho, 'AI岗位的薪资怎么样'), true);
  assert.equal(isLikelyPromptTemplateOrPlaceholder('AI 岗位的薪资怎么样', 'AI岗位的薪资怎么样'), true);
});

test('cleanAiAnswerText correctly strips leading reference lists and trailing suggestion chips', () => {
  const messyWenxinText = `共参考30篇资料

                1.
                【2026优化版】这绝对是B站最好的人工智能快速入门天花板教程!通俗易懂,一套解决人工智能所有问题!我是小土堆a

                30.
                2026年合肥AI培训机构深度测评:黑马程序员如何领跑大模型与具身智能人才培养赛道

                    结合你作为日化行业技术人员的职场赋能需求，2026年市面上不同定位的优质人工智能课程各有侧重，以下按不同学习需求分类推荐：
一、零基础通识入门类

1. 智慧树《走进人工智能》
- 核心优势：知识体系完整

选课核心参考标准

需要我结合你日化行业的职场场景，帮你筛选适配的AI提效专属课程方向吗？

                        🆗 行，继续吧给我推荐几家人工智能课程机构零基础学AI，哪家机构性价比最高零基础学AI，选线上还是线下培训`;

  const cleaned = cleanAiAnswerText(messyWenxinText);

  assert.equal(cleaned.includes('共参考30篇资料'), false);
  assert.equal(cleaned.includes('【2026优化版】这绝对是B站最好的人工智能'), false);
  assert.equal(cleaned.includes('🆗 行，继续吧'), false);
  assert.equal(cleaned.startsWith('结合你作为日化行业技术人员的职场赋能需求'), true);
  assert.equal(cleaned.endsWith('需要我结合你日化行业的职场场景，帮你筛选适配的AI提效专属课程方向吗？'), true);
});

test('cleanAiAnswerText correctly handles media card timestamps and 👌 emoji suggestion chips', () => {
  const mediaCardWenxinText = `一、核心基础信息
- 本质定位：人工智能基石

四、产业发展现状
- 发展趋势：知识密集型

                01:12

        什么是“数据标注”?一篇视频带你快速读懂大众日报

                03:50

        一个视频告诉你什么是数据标注发家致富要卖鱼

需要我为你介绍数据标注的常见工具和入门学习路径吗？帮你快速了解入行相关信息。

                        👌 好的，继续吧给我一些数据标注的实例数据标注员需要掌握哪些技能`;

  const cleaned = cleanAiAnswerText(mediaCardWenxinText);

  assert.equal(cleaned.includes('👌 好的，继续吧'), false);
  assert.equal(cleaned.includes('01:12'), false);
  assert.equal(cleaned.includes('03:50'), false);
  assert.equal(cleaned.endsWith('需要我为你介绍数据标注的常见工具和入门学习路径吗？帮你快速了解入行相关信息。'), true);
});

test('Yuanbao platform defines robust message container and exclusion selectors', () => {
  const yb = PLATFORMS.yuanbao;
  assert.ok(yb);
  assert.ok(yb.messageContainerSelectors.some((s) => s.includes('agent-chat__conv--ai')));
  assert.ok(yb.newChatSelectors && yb.newChatSelectors.length > 0);
  assert.ok(NON_ANSWER_EXCLUDE_SELECTORS.some((s) => s.includes('inspiration')));
  assert.ok(NON_ANSWER_EXCLUDE_SELECTORS.some((s) => s.includes('prompt-card')));
  assert.ok(NON_ANSWER_EXCLUDE_SELECTORS.some((s) => s.includes('agent-chat__conv--user')));
  assert.ok(NON_ANSWER_EXCLUDE_SELECTORS.some((s) => s.includes('reference')));
  assert.ok(NON_ANSWER_EXCLUDE_SELECTORS.some((s) => s.includes('guess')));
});

test('Nami and Wenxin platforms define newChatSelectors and messageContainerSelectors', () => {
  assert.ok(PLATFORMS.nami.newChatSelectors && PLATFORMS.nami.newChatSelectors.length > 0);
  assert.ok(PLATFORMS.nami.messageContainerSelectors.length > 0);

  assert.ok(PLATFORMS.wenxin.newChatSelectors && PLATFORMS.wenxin.newChatSelectors.length > 0);
  assert.ok(PLATFORMS.wenxin.messageContainerSelectors.length > 0);
  assert.ok(PLATFORMS.wenxin.ownDomains.includes('chat.baidu.com'));
});
