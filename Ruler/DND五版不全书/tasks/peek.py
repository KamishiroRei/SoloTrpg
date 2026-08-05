import sys, os
sys.stdout.reconfigure(encoding='utf-8')
with open('compressed/rule_tables.md', encoding='utf-8') as f:
    content = f.read()
print('总长度:', len(content))
print('--- 标题列表 ---')
for line in content.splitlines():
    if line.startswith('## '):
        print(line)
