#!/bin/zsh
set -e
trap 'exit_code=$?; if (( exit_code != 0 )); then print "连接流程未完成（退出码 $exit_code），请回客户端查看检测状态。"; if [[ -t 0 ]]; then read "done?按回车关闭："; fi; fi' EXIT
cd "${0:A:h}"
reader="$PWD/vendor/greenbubbles/greenbubbles"
helper="$PWD/vendor/greenbubbles/greenbubbles-acquire"
key_file="$HOME/.greenbubbles-acquire/passphrase.txt"
print "微信本机直接连接助手：不导出、不导入聊天文件。"
if "$reader" source status >/dev/null 2>&1; then
  print "微信数据库已经可读。回到应用点击重新检测即可。"
  read "done?按回车关闭："
  exit 0
fi
if [[ -e "$key_file" ]]; then
  print "已有数据库密钥但数据源不可读。为保护现有设置，本助手不会覆盖密钥或重签微信。"
  print "请检查 GreenBubbles 配置/兼容性；此时不应重新捕获或导入聊天。"
  read "done?按回车关闭："
  exit 1
fi
print "首次连接需要重签 /Applications/WeChat.app，替换其原始安全签名，允许调试器获取你自己的数据库密钥。"
print "此操作改变微信的安全保护。微信更新后会恢复原始签名。数据库不会被修改。"
print "管理员密码仅在 macOS 本机 sudo 提示中输入，本应用不读取密码。"
print "你需要退出并重开微信，然后在捕获阶段退出微信账号并重新登录。"
read "consent?明确同意以上操作请输入 CONNECT；其他输入取消："
[[ "$consent" == "CONNECT" ]] || { print "已取消，未连接微信。"; exit 130; }
[[ -d /Applications/WeChat.app ]] || { print "未找到微信安装。"; exit 1; }
/usr/bin/xcrun --find lldb >/dev/null 2>&1 || { print "缺少 Xcode Command Line Tools，请先安装后再连接。"; exit 1; }
old_wechat_pids=(${(f)$(/usr/bin/pgrep -x WeChat || true)})
if ! sudo /usr/bin/codesign --force --deep --sign - /Applications/WeChat.app; then
  print "微信重签失败；尚未开始获取数据库密钥。"
  print "如果上方显示 Operation not permitted：打开 系统设置 → 隐私与安全性 → App 管理（应用程序管理），允许 终端 / Terminal 修改其他应用。"
  print "sudo 管理员权限不能代替 App 管理授权。授权后完全退出终端，再重新打开本助手。"
  print "该权限允许终端修改其他应用；首次连接完成后可关闭此权限。"
  print "如仍失败，请保留上方错误；不要反复重签。"
  exit 1
fi
print "请切到微信按 ⌘Q（微信菜单 → 退出微信），再重新打开并登录。关闭窗口或退出账号不等于退出应用。"
read "ready?完全退出并重开后按回车检查："
while true; do
  old_process_alive=false
  for wechat_pid in "${old_wechat_pids[@]}"; do
    if /bin/kill -0 "$wechat_pid" 2>/dev/null; then old_process_alive=true; fi
  done
  if [[ "$old_process_alive" == false ]]; then break; fi
  print "检测到重签前的微信进程仍在运行，尚未完成重启。不会开始捕获密钥。"
  read "ready?请在微信按 ⌘Q，重新打开并登录后按回车再次检查："
done
while ! /usr/bin/pgrep -x WeChat >/dev/null; do
  print "微信尚未重新打开。助手会等你，不会开始捕获。"
  read "ready?打开微信并登录后按回车检查（Ctrl+C 取消）："
done
install -d -m 700 "$HOME/.greenbubbles-acquire"
while true; do
  while ! sudo "$helper" preflight; do
    print "准备检查未通过，尚未捕获。请按上方提示操作，助手会停在这里等你。"
    read "ready?处理完成后按回车重试（Ctrl+C 取消）："
  done
  print "准备检查通过。下一步给你最多 15 分钟操作。"
  print "先保持微信已登录；捕获工具显示 waiting / 等待登录之后，再在微信里退出账号并重新登录。"
  read "ready?准备好后按回车启动捕获（现在还没有开始计时）："
  if sudo "$helper" capture --output "$key_file" --timeout-seconds 900; then break; fi
  if [[ -e "$key_file" ]]; then
    print "捕获返回失败但密钥文件已存在，为保护文件停止重试，请回客户端重新检测。"
    exit 1
  fi
  print "本次捕获未完成，没有保存密钥。可以处理上方问题后重试，不会重新重签。"
  read "ready?按回车重新检查并重试（Ctrl+C 取消）："
done
# The privileged helper creates the file as root; return it to the invoking user without reading its contents.
sudo /usr/sbin/chown "$UID" "$key_file"
chmod 600 "$key_file"
if "$reader" source status >/dev/null 2>&1; then
  print "连接成功。回到客户端点击重新检测，联系人和聊天将直接从本机微信读取。"
else
  print "密钥捕获完成，但数据库读取仍失败。连接未完成；请检查微信兼容性。"
  exit 1
fi
read "done?按回车关闭："
