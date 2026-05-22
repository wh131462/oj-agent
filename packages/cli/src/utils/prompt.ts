/**
 * 交互式提示工具。基于 node:readline,最小实现。
 * 不引入 inquirer / enquirer 等第三方包。
 */

import * as readline from 'node:readline';

export async function promptText(
  question: string,
  opts: { hidden?: boolean } = {},
): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error('当前非 TTY,无法交互式输入。请通过 --cookie 等 flag 提供值。');
  }

  if (opts.hidden) {
    return promptHidden(question);
  }

  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stderr.write(question);
    let input = '';
    const onData = (chunk: Buffer): void => {
      const data = chunk.toString('utf-8');
      for (const ch of data) {
        if (ch === '\r' || ch === '\n') {
          stdin.removeListener('data', onData);
          stdin.setRawMode(false);
          stdin.pause();
          process.stderr.write('\n');
          return resolve(input.trim());
        }
        if (ch === '') {
          // Ctrl-C
          stdin.removeListener('data', onData);
          stdin.setRawMode(false);
          stdin.pause();
          process.stderr.write('\n');
          return reject(new Error('interrupted'));
        }
        if (ch === '' || ch === '\b') {
          if (input.length > 0) input = input.slice(0, -1);
          continue;
        }
        input += ch;
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

export async function promptConfirm(question: string, def = false): Promise<boolean> {
  if (!process.stdin.isTTY) return def;
  const hint = def ? '[Y/n]' : '[y/N]';
  const ans = (await promptText(`${question} ${hint} `)).toLowerCase();
  if (ans === '') return def;
  return ans === 'y' || ans === 'yes';
}
