// ── 工具：bash（执行 shell 命令） ──
// 依赖注入：ctx.appConfig / ctx.spawn / ctx.decodeWinOutput / ctx.shared
module.exports = {
  name: 'bash',
  definition: { type: 'function', function: { name: 'bash', description: '执行一条 shell 命令。Windows 使用 cmd.exe，POSIX 使用 /bin/sh，可由 config.json 顶层 shell 覆盖。工作目录=对应scope根（__root__=项目根；path 传项目外绝对目录时=该目录），返回附带[cwd:路径]；不要写相对cd，直接用根目录相对路径或绝对路径；统计/枚举类需求优先用list_files/glob；脚本先写入_tools/再执行，避免node -e内联；timeout 为毫秒（默认120000，最大600000）。', parameters: { type: 'object', properties: { system: { type: 'string', description: '同文件工具；缺省__root__' }, command: { type: 'string' }, timeout: { type: 'number', description: '超时毫秒，默认120000，最大600000' } }, required: ['command'] } } },
  async execute(args, ctx) {
    const { fs, path } = ctx.shared;
    const appConfig = ctx.appConfig;
    const spawn = ctx.spawn;
    const decodeWinOutput = ctx.decodeWinOutput;
    const cmd = String(args.command || '');
    if (!cmd) return '请提供命令';
    if (/^(findstr|dir|tree|wc|ls|ll)\b/i.test(cmd.trim())) {
      return '提示：统计文件/行数/目录结构建议用 list_files/glob/list_tree 工具（更省token且结果结构化）。若确实需要执行命令，可继续直接写完整命令（如 type 文件、python 脚本等）。';
    }
    const getBashShell = () => (appConfig.shell && typeof appConfig.shell === 'string' && appConfig.shell.trim())
      ? appConfig.shell.trim()
      : (process.platform === 'win32' ? (process.env.COMSPEC || 'cmd.exe') : '/bin/sh');
    const shell = getBashShell();
    const isCmd = /cmd\.exe|comspec/i.test(shell) || !process.platform || process.platform === 'win32' && !shell.includes('bash');
    const timeout = Math.min(Math.max(Number(args.timeout) || 120000, 1000), 600000);
    const MAX_OUT = 16 * 1024 * 1024;
    let cwd = path.dirname(ctx.target);
    if (ctx.isRootScope) cwd = path.resolve(ctx.root);
    else if (ctx.isAbsScope && fs.existsSync(ctx.target) && fs.statSync(ctx.target).isDirectory()) cwd = ctx.target;
    const guide = (msg) => {
      if (/not recognized|不是内部或外部命令|is not recognized/i.test(msg)) return '（命令不存在：Windows cmd 环境无 head/grep/sed 等 Unix 命令，用 type/echo/findstr 或改用 read_file/grep 工具）';
      if (/node.*-e|\[eval\]/i.test(msg)) return '（node -e 内联脚本引号转义易失败：请把脚本写入 _tools/ 下的 .js 文件再 node 执行，或用工具直接读写文件）';
      if (/maxBuffer|ENAMETOOLONG|EINVAL|EPERM/i.test(msg)) return '（命令输出过大/参数过长/文件占用：拆小任务或改用 read_file 分片读取；文件被占用通常是软件正在运行）';
      return '（检查命令路径与引号；不要反复试同一命令的变体，改一次错误再执行，或改用标准工具）';
    };
    const fail = (msg) => '命令执行失败: ' + String(msg || '').substring(0, 300) + `\n[当前工作目录: ${cwd}]（命令基于此目录执行；不要用相对 cd，直接用绝对路径或基于此目录的相对路径）\n` + guide(String(msg || ''));
    const ok = (text) => `[cwd: ${cwd}]` + (/^cd\s/i.test(cmd.trim()) ? '\n（工作目录已定位，通常无需再 cd；相对路径直接基于该目录写）' : '') + '\n' + String(text || '（命令执行完成，无输出）');
    return await new Promise((resolve) => {
      const args2 = isCmd ? ['/d', '/s', '/c', '"' + cmd + '"'] : ['-lc', cmd];
      const cp = spawn(shell, args2, { cwd, windowsHide: true, windowsVerbatimArguments: isCmd });
      let out = Buffer.alloc(0), errOut = Buffer.alloc(0), done = false;
      const finish = (fn) => { if (!done) { done = true; clearTimeout(timer); fn(); } };
      const timer = setTimeout(() => { cp.kill(); finish(() => resolve(fail('命令超时（' + timeout + 'ms）'))); }, timeout);
      const acc = (buf, chunk) => {
        const n = Buffer.concat([buf, chunk]);
        if (n.length > MAX_OUT) { cp.kill(); finish(() => resolve(fail('命令输出超过16MB上限，请拆小任务'))); return null; }
        return n;
      };
      cp.stdout.on('data', (d) => { const n = acc(out, d); if (n) out = n; });
      cp.stderr.on('data', (d) => { const n = acc(errOut, d); if (n) errOut = n; });
      cp.on('error', (e) => finish(() => resolve(fail(e.message))));
      cp.on('close', (code) => {
        finish(() => {
          const outText = isCmd ? decodeWinOutput(out) : out.toString('utf8');
          const errText = isCmd ? decodeWinOutput(errOut) : errOut.toString('utf8');
          if (code !== 0) resolve(fail(errText || outText));
          else resolve(ok(outText.trim()));
        });
      });
    });
  }
};
