export interface SampleCase {
  input: string;
  expectedOutput: string;
}

export interface FailedCase extends SampleCase {
  actualOutput: string;
  diff?: string;
}

export interface ProblemDetail {
  platform: string;
  problemId: string;
  title: string;
  /** Markdown 题面 */
  statement: string;
  samples: SampleCase[];
  language?: string;
}

export interface AIAction {
  kind: 'explainError' | 'generateApproach' | 'generateSolution' | 'explainCode';
}

export interface AIContextInput {
  action: AIAction;
  problem: ProblemDetail;
  code?: string;
  selection?: string;
  failedCase?: FailedCase;
}

export interface BuiltContext {
  system: string;
  user: string;
}

const SYSTEM_BASE = '你是一名资深算法竞赛教练。回答简洁、分点、用中文。代码块使用对应语言的高亮 fenced block。';

function problemBlock(p: ProblemDetail): string {
  return [
    `# 题目: ${p.platform} ${p.problemId} ${p.title}`,
    '',
    p.statement,
  ].join('\n');
}

function samplesBlock(samples: SampleCase[]): string {
  if (samples.length === 0) return '';
  return samples
    .map(
      (s, i) =>
        `### 样例 ${i + 1}\n输入:\n\`\`\`\n${s.input}\n\`\`\`\n期望输出:\n\`\`\`\n${s.expectedOutput}\n\`\`\``,
    )
    .join('\n\n');
}

function failedBlock(f: FailedCase): string {
  return [
    '### 失败用例',
    `输入:\n\`\`\`\n${f.input}\n\`\`\``,
    `期望输出:\n\`\`\`\n${f.expectedOutput}\n\`\`\``,
    `实际输出:\n\`\`\`\n${f.actualOutput}\n\`\`\``,
    f.diff ? `差异:\n\`\`\`diff\n${f.diff}\n\`\`\`` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildContext(input: AIContextInput): BuiltContext {
  const { action, problem, code, selection, failedCase } = input;
  switch (action.kind) {
    case 'explainError': {
      const user = [
        problemBlock(problem),
        '',
        '## 当前代码',
        `\`\`\`${problem.language ?? ''}`,
        code ?? '',
        '```',
        '',
        '## 测试结果',
        failedCase ? failedBlock(failedCase) : '(无失败用例)',
        '',
        '请：1) 指出错因；2) 提出修复方向；3) 给出最小修改片段。',
      ].join('\n');
      return { system: SYSTEM_BASE, user };
    }
    case 'generateApproach': {
      const user = [
        problemBlock(problem),
        '',
        samplesBlock(problem.samples),
        '',
        '请给出 2-3 个由浅入深的解题思路，比较复杂度，不要给出完整代码。',
      ].join('\n');
      return { system: SYSTEM_BASE, user };
    }
    case 'generateSolution': {
      const user = [
        problemBlock(problem),
        '',
        samplesBlock(problem.samples),
        '',
        `请给出一份完整可编译的题解代码，语言: ${problem.language ?? 'C++'}。先简述思路，再给出代码与复杂度。`,
      ].join('\n');
      return { system: SYSTEM_BASE, user };
    }
    case 'explainCode': {
      const snippet = selection && selection.length > 0 ? selection : code ?? '';
      const user = [
        problemBlock(problem),
        '',
        '## 待解释代码',
        `\`\`\`${problem.language ?? ''}`,
        snippet,
        '```',
        '',
        '请逐段解释代码：变量含义、关键步骤、算法/数据结构选择、潜在边界问题。',
      ].join('\n');
      return { system: SYSTEM_BASE, user };
    }
  }
}
