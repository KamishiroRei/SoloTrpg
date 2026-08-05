import sys
sys.stdout.reconfigure(encoding='utf-8')
with open('compressed/rule_tables.md', encoding='utf-8') as f:
    content = f.read()
# 打印 角色起源 与 万法大全 两个表的内容概览
import re
for title in ['## 角色起源', '## 万法大全速查表（源：速查/法术速查/5E万法大全.html）']:
    idx = content.find(title)
    if idx >= 0:
        end = content.find('\n## ', idx+5)
        seg = content[idx:end if end>0 else idx+2500]
        print(seg[:2200])
        print('======')
