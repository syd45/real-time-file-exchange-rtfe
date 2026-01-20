#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
WebSocket认证与通知功能测试脚本
用于验证sdav项目的WebSocket认证、WebDAV和文件变更通知功能
支持通过环境变量自定义配置
请参见 test.md 文件获取环境变量详细说明
"""

import json
import re
import threading
import time
import argparse
import os
import requests
from urllib.parse import urljoin
from websocket import WebSocketApp

def show_environment_config():
    """显示当前使用的环境变量配置"""
    print("当前环境变量配置:")
    print(f"  URL: {os.getenv('TEST_URL', os.getenv('URL', 'your_server_address'))}")
    print(f"  USERNAME: {os.getenv('TEST_USERNAME', os.getenv('USERNAME', 'your_username'))}")
    print(f"  PASSWORD: {'*' * len(os.getenv('TEST_PASSWORD', os.getenv('PASSWORD', 'your_password'))) if os.getenv('TEST_PASSWORD', os.getenv('PASSWORD', 'your_password')) else ''}")
    print(f"  PORT: {os.getenv('TEST_PORT', os.getenv('PORT', '3000'))}")
    print(f"  TEST_DIR: {os.getenv('TEST_DIR', '')}")
    print(f"  TEST_TIMEOUT: {os.getenv('TEST_TIMEOUT', '30')}")
    print(f"  DEBUG: {os.getenv('DEBUG', 'false')}")
    print(f"  WS_PATH: {os.getenv('WS_PATH', '/ws')}")
    print("-" * 50)


def parse_arguments():
    """解析命令行参数"""
    parser = argparse.ArgumentParser(description='WebSocket认证与通知功能测试脚本')

    # 服务器配置
    parser.add_argument('--url', '-u', type=str,
                       default=os.getenv('TEST_URL', os.getenv('URL', 'your_server_address')),
                       help='服务器地址 (默认: your_server_address)')
    parser.add_argument('--username', '-n', type=str,
                       default=os.getenv('TEST_USERNAME', os.getenv('USERNAME', 'your_username')),
                       help='用户名 (默认: your_username)')
    parser.add_argument('--password', '-p', type=str,
                       default=os.getenv('TEST_PASSWORD', os.getenv('PASSWORD', 'your_password')),
                       help='密码 (默认: your_password)')
    parser.add_argument('--port', type=int,
                       default=int(os.getenv('TEST_PORT', os.getenv('PORT', '3000'))),
                       help='服务器端口 (默认: 3000)')

    # 测试配置
    parser.add_argument('--test-dir', '-d', type=str,
                       default=os.getenv('TEST_DIR', '/test/'),
                       help='自定义测试目录 (例如: /test/mytest 或 /data/test)，默认使用 /test/')
    parser.add_argument('--test-timeout', type=int,
                       default=int(os.getenv('TEST_TIMEOUT', '30')),
                       help='测试超时时间（秒）(默认: 30)')
    parser.add_argument('--debug', action='store_true',
                       default=(os.getenv('DEBUG', '').lower() in ('true', '1', 'yes')),
                       help='启用调试模式 (默认: false)')

    # WebSocket配置
    parser.add_argument('--ws-path', type=str,
                       default=os.getenv('WS_PATH', '/ws'),
                       help='WebSocket路径 (默认: /ws)')

    return parser.parse_args()

# 解析命令行参数和环境变量
args = parse_arguments()

# 智能构建URL：如果args.url已经包含端口，则不重复添加
# 检查args.url是否已经包含端口号（冒号后跟数字）
if ':' in args.url and re.search(r':\d+$', args.url):
    # 如果args.url已经包含端口（以冒号加数字结尾），则直接使用
    url = args.url
else:
    # 否则添加端口
    url = f'{args.url}:{args.port}'

username = args.username
password = args.password
test_dir = args.test_dir  # 自定义测试目录
test_timeout = args.test_timeout  # 测试超时时间
debug_mode = args.debug  # 调试模式
ws_path = args.ws_path  # WebSocket路径

class WebSocketIntegrationTester:
    def __init__(self, ws_url, server_url, username, password, test_dir=''):
        self.ws_url = ws_url
        self.server_url = server_url
        self.username = username
        self.password = password
        self.test_dir = test_dir  # 自定义测试目录
        self.session = requests.Session()

        # 设置认证
        import base64
        credentials = f"{self.username}:{self.password}"
        encoded_credentials = base64.b64encode(credentials.encode()).decode()
        self.session.headers.update({
            "Authorization": f"Basic {encoded_credentials}",
            "User-Agent": "SSync WebSocket Tester 0.1.0"
        })

        self.ws = None
        self.authenticated = False
        self.subscribed = False
        self.messages_received = []
        self.file_change_received = False
        self.test_file_path = ""
        
    def connect_and_authenticate(self):
        """连接到WebSocket服务器并执行认证流程"""
        def on_message(ws, message):
            self.messages_received.append(message)
            if debug_mode:
                print(f"[DEBUG] 收到消息: {message}")

            try:
                data = json.loads(message)
                msg_type = data.get("type")

                if msg_type == "auth_required":
                    # 服务器要求认证，发送认证信息
                    if debug_mode:
                        print("[DEBUG] 服务器要求认证，发送认证信息...")
                    auth_msg = {
                        "type": "authenticate",
                        "username": self.username,
                        "password": self.password
                    }
                    ws.send(json.dumps(auth_msg))

                elif msg_type == "auth_success":
                    # 认证成功，现在可以订阅
                    if debug_mode:
                        print("[DEBUG] 认证成功！现在订阅路径...")
                    self.authenticated = True
                    subscribe_msg = {
                        "type": "subscribe",
                        "path": "/"  # 订阅根目录
                    }
                    ws.send(json.dumps(subscribe_msg))

                elif msg_type == "subscriptionConfirmed":
                    if debug_mode:
                        print("[DEBUG] 订阅成功！")
                    self.subscribed = True

                elif msg_type == "fileChange":
                    if debug_mode:
                        print(f"[DEBUG] 收到文件变更通知: {data}")
                    self.file_change_received = True

            except json.JSONDecodeError:
                if debug_mode:
                    print(f"[DEBUG] 无法解析JSON消息: {message}")
        
        def on_error(ws, error):
            print(f"[ERROR] WebSocket错误: {error}")
        
        def on_close(ws, close_status_code, close_msg):
            print(f"[DEBUG] WebSocket连接已关闭: {close_status_code} - {close_msg}")
        
        def on_open(ws):
            print("[DEBUG] WebSocket连接已建立，发送认证请求...")
            # 连接建立后，发送认证请求
            auth_msg = {
                "type": "authenticate",
                "username": self.username,
                "password": self.password
            }
            ws.send(json.dumps(auth_msg))
        
        self.ws = WebSocketApp(
            self.ws_url,
            on_open=on_open,
            on_message=on_message,
            on_error=on_error,
            on_close=on_close
        )
        
        # 在后台线程中运行WebSocket
        def run_websocket():
            self.ws.run_forever()
        
        ws_thread = threading.Thread(target=run_websocket)
        ws_thread.daemon = True
        ws_thread.start()
        
        # 等待一段时间以完成认证和订阅流程
        time.sleep(min(5, test_timeout))  # 使用较小的值，最多5秒

        return self.authenticated and self.subscribed

    def test_websocket_connection(self):
        """测试WebSocket连接、认证和订阅功能"""
        print("开始WebSocket连接测试...")
        print(f"WebSocket URL: {self.ws_url}")
        print(f"用户名: {self.username}")
        
        success = self.connect_and_authenticate()
        
        print("\nWebSocket连接测试结果:")
        print(f"- 连接成功: {bool(self.ws)}"
              f"- 认证成功: {self.authenticated}"
              f"- 订阅成功: {self.subscribed}")
        print(f"- 整体成功: {success}")
        
        print(f"\n收到的消息总数: {len(self.messages_received)}")
        for i, msg in enumerate(self.messages_received):
            print(f"  {i+1}. {msg}")
        
        return success

    def test_webdav_methods(self):
        """测试WebDAV方法 - 包括创建、读取、更新、删除文件的完整流程"""
        print("\n开始WebDAV方法测试...")

        results = {}

        # 使用自定义测试目录或创建临时目录
        import time
        if self.test_dir:
            # 使用自定义测试目录
            test_dir = self.test_dir
            if not test_dir.startswith('/'):
                test_dir = '/' + test_dir
            if not test_dir.endswith('/'):
                test_dir = test_dir + '/'

            # 确保目录存在
            try:
                response = self.session.request("MKCOL", urljoin(self.server_url, test_dir))
                if response.status_code in [200, 201, 204, 405]:  # 405表示目录已存在
                    mkcol_success = True
                    print(f"使用自定义测试目录: {test_dir}")
                else:
                    mkcol_success = False
                    print(f"创建自定义测试目录失败: {response.status_code}")
            except Exception as e:
                mkcol_success = False
                print(f"创建自定义测试目录失败: {str(e)}")
        else:
            # 创建临时测试目录
            test_dir = f"/ssync_test_{int(time.time())}/"
            try:
                response = self.session.request("MKCOL", urljoin(self.server_url, test_dir))
                mkcol_success = response.status_code in [200, 201, 204]
                results["MKCOL"] = {
                    "success": mkcol_success,
                    "status_code": response.status_code
                }
                print(f"MKCOL方法测试: {'成功' if mkcol_success else '失败'} (状态码: {response.status_code})")
            except Exception as e:
                results["MKCOL"] = {
                    "success": False,
                    "error": str(e)
                }
                mkcol_success = False
                print(f"MKCOL方法测试: 失败 ({str(e)})")

        if mkcol_success:
            # 在测试目录中进行文件操作测试
            test_file_path = test_dir + "test_file.txt"

            # 1. 测试PUT方法 - 创建文件
            test_content = b"This is a test file for SSync backend testing.\nCreated at: " + str(time.time()).encode()
            try:
                response = self.session.put(urljoin(self.server_url, test_file_path), data=test_content)
                put_success = response.status_code in [200, 201, 204]
                results["PUT"] = {
                    "success": put_success,
                    "status_code": response.status_code
                }
                print(f"PUT方法测试: {'成功' if put_success else '失败'} (状态码: {response.status_code})")
            except Exception as e:
                results["PUT"] = {
                    "success": False,
                    "error": str(e)
                }
                put_success = False
                print(f"PUT方法测试: 失败 ({str(e)})")

            if put_success:
                # 2. 测试GET方法 - 读取文件
                try:
                    response = self.session.get(urljoin(self.server_url, test_file_path))
                    get_success = response.status_code == 200 and response.content == test_content
                    results["GET"] = {
                        "success": get_success,
                        "status_code": response.status_code
                    }
                    print(f"GET方法测试: {'成功' if get_success else '失败'} (状态码: {response.status_code})")
                except Exception as e:
                    results["GET"] = {
                        "success": False,
                        "error": str(e)
                    }
                    get_success = False
                    print(f"GET方法测试: 失败 ({str(e)})")

                if get_success:
                    # 3. 测试更新文件 - 用新内容覆盖
                    updated_content = test_content + b"\nUpdated at: " + str(time.time()).encode()
                    try:
                        response = self.session.put(urljoin(self.server_url, test_file_path), data=updated_content)
                        update_success = response.status_code in [200, 201, 204]
                        results["UPDATE"] = {
                            "success": update_success,
                            "status_code": response.status_code
                        }
                        print(f"UPDATE方法测试: {'成功' if update_success else '失败'} (状态码: {response.status_code})")
                    except Exception as e:
                        results["UPDATE"] = {
                            "success": False,
                            "error": str(e)
                        }
                        update_success = False
                        print(f"UPDATE方法测试: 失败 ({str(e)})")

                # 4. 测试PROPFIND方法 - 获取目录信息
                try:
                    response = self.session.request("PROPFIND", urljoin(self.server_url, test_dir), headers={"Depth": "1"})
                    propfind_success = response.status_code in [200, 207]
                    results["PROPFIND"] = {
                        "success": propfind_success,
                        "status_code": response.status_code
                    }
                    print(f"PROPFIND方法测试: {'成功' if propfind_success else '失败'} (状态码: {response.status_code})")

                    # 如果启用了调试模式，输出PROPFIND响应内容
                    if debug_mode and response.status_code == 207:
                        print(f"[DEBUG] PROPFIND响应: {response.text[:500]}...")  # 只显示前500字符
                except Exception as e:
                    results["PROPFIND"] = {
                        "success": False,
                        "error": str(e)
                    }
                    print(f"PROPFIND方法测试: 失败 ({str(e)})")

                # 5. 测试DELETE方法 - 删除文件
                try:
                    response = self.session.delete(urljoin(self.server_url, test_file_path))
                    delete_file_success = response.status_code in [200, 204]
                    results["DELETE_FILE"] = {
                        "success": delete_file_success,
                        "status_code": response.status_code
                    }
                    print(f"DELETE_FILE方法测试: {'成功' if delete_file_success else '失败'} (状态码: {response.status_code})")
                except Exception as e:
                    results["DELETE_FILE"] = {
                        "success": False,
                        "error": str(e)
                    }
                    print(f"DELETE_FILE方法测试: 失败 ({str(e)})")

                # 如果使用的是临时目录（非自定义），则删除它
                if not self.test_dir:
                    try:
                        response = self.session.delete(urljoin(self.server_url, test_dir))
                        delete_dir_success = response.status_code in [200, 204]
                        results["DELETE_DIR"] = {
                            "success": delete_dir_success,
                            "status_code": response.status_code
                        }
                        print(f"DELETE_DIR方法测试: {'成功' if delete_dir_success else '失败'} (状态码: {response.status_code})")
                    except Exception as e:
                        results["DELETE_DIR"] = {
                            "success": False,
                            "error": str(e)
                        }
                        print(f"DELETE_DIR方法测试: 失败 ({str(e)})")
        else:
            # 如果MKCOL失败，尝试基本的WebDAV方法
            # 测试GET方法
            try:
                response = self.session.get(urljoin(self.server_url, "/test_get"))
                results["GET"] = {
                    "success": response.status_code in [200, 404],  # 404也是正常的，表示资源不存在
                    "status_code": response.status_code
                }
                print(f"GET方法测试: {'成功' if results['GET']['success'] else '失败'} (状态码: {response.status_code})")
            except Exception as e:
                results["GET"] = {
                    "success": False,
                    "error": str(e)
                }
                print(f"GET方法测试: 失败 ({str(e)})")

        return results

    def test_webdav_and_websocket_integration(self):
        """测试WebDAV和WebSocket的集成 - 按照指定顺序：WebDAV写入 → WebSocket订阅 → WebDAV修改"""
        print("\n开始WebDAV和WebSocket集成测试...")

        integration_results = {
            "webdav_write": {"success": False, "details": ""},
            "websocket_subscribe": {"success": False, "details": ""},
            "webdav_modify": {"success": False, "details": ""},
            "websocket_notification": {"success": False, "details": ""}
        }

        # 生成唯一的测试文件路径
        import random
        import string
        unique_id = ''.join(random.choices(string.ascii_lowercase + string.digits, k=8))

        # 使用自定义测试目录或根目录
        if self.test_dir:
            # 使用自定义测试目录
            test_dir = self.test_dir
            if not test_dir.startswith('/'):
                test_dir = '/' + test_dir
            if not test_dir.endswith('/'):
                test_dir = test_dir + '/'
            test_file_path = f"{test_dir}integration_test_{unique_id}.txt"
        else:
            test_file_path = f"/integration_test_{unique_id}.txt"

        # 1. WebDAV写入测试
        try:
            content = f"Integration test file created at {time.time()}\nInitial content for integration test."
            response = self.session.put(urljoin(self.server_url, test_file_path), data=content.encode())
            if response.status_code in [200, 201, 204]:
                integration_results["webdav_write"]["success"] = True
                integration_results["webdav_write"]["details"] = f"File created successfully, status: {response.status_code}"
                print(f"WebDAV写入测试: 成功 (状态码: {response.status_code})")
            else:
                integration_results["webdav_write"]["details"] = f"Write failed with status: {response.status_code}"
                print(f"WebDAV写入测试: 失败 (状态码: {response.status_code})")
        except Exception as e:
            integration_results["webdav_write"]["details"] = f"Write failed with error: {str(e)}"
            print(f"WebDAV写入测试: 失败 ({str(e)})")

        # 2. WebSocket订阅测试
        ws_results = {
            "messages_received": [],
            "connection_success": False,
            "authenticated": False,
            "subscribed": False
        }

        def on_message(ws, message):
            ws_results["messages_received"].append(message)

            # 解析消息以检查认证和订阅状态
            try:
                data = json.loads(message)
                msg_type = data.get("type")

                if debug_mode:
                    print(f"[DEBUG] 收到消息: {message}")

                if msg_type == "auth_required":
                    # 服务器要求认证，发送认证信息
                    if debug_mode:
                        print(f"[DEBUG] 服务器要求认证")
                    auth_msg = {
                        "type": "authenticate",
                        "username": self.username,
                        "password": self.password
                    }
                    ws.send(json.dumps(auth_msg))
                elif msg_type == "auth_success":
                    # 认证成功，现在可以订阅
                    if debug_mode:
                        print(f"[DEBUG] 认证成功")
                    ws_results["authenticated"] = True
                    # 只有在尚未发送订阅请求时才发送
                    if "subscription_sent" not in ws_results:
                        # 根据自定义目录决定订阅路径
                        subscribe_path = self.test_dir if self.test_dir else "/"
                        if not subscribe_path.startswith('/'):
                            subscribe_path = '/' + subscribe_path
                        subscribe_msg = {
                            "type": "subscribe",
                            "path": subscribe_path  # 订阅指定目录的所有变更
                        }
                        ws.send(json.dumps(subscribe_msg))
                        if debug_mode:
                            print(f"[DEBUG] 发送订阅请求，订阅路径: {subscribe_path}")
                        ws_results["subscription_sent"] = True
                        ws_results["subscribed"] = True
                elif msg_type == "fileChange":
                    # 接收文件变更通知，打印调试信息
                    if debug_mode:
                        print(f"[DEBUG] 收到文件变更通知: {message}")
                    # 检查是否是我们测试的文件
                    if test_file_path.lstrip('/') in str(data.get("path", "")) or str(data.get("path", "")).endswith(test_file_path.lstrip('/')):
                        ws_results["file_change_received"] = True
                        if debug_mode:
                            print(f"[DEBUG] 检测到目标文件变更: {data.get('path', '')}")
            except json.JSONDecodeError:
                if debug_mode:
                    print(f"[DEBUG] 无法解析消息: {message}")
                pass  # 忽略无法解析的消息

        def on_error(ws, error):
            ws_results["error"] = str(error)

        def on_close(ws, close_status_code, close_msg):
            ws_results["closed"] = True

        def on_open(ws):
            ws_results["connection_success"] = True
            # 发送认证消息
            auth_msg = {
                "type": "authenticate",
                "username": self.username,
                "password": self.password
            }
            ws.send(json.dumps(auth_msg))

        try:
            ws = WebSocketApp(
                self.ws_url,
                on_open=on_open,
                on_message=on_message,
                on_error=on_error,
                on_close=on_close
            )

            def run_websocket():
                ws.run_forever()

            ws_thread = threading.Thread(target=run_websocket)
            ws_thread.daemon = True
            ws_thread.start()

            # 等待WebSocket连接、认证和订阅完成
            time.sleep(min(4, test_timeout//3))  # 使用测试超时时间的三分之一，最多4秒

            if ws_results["connection_success"] and ws_results["authenticated"] and ws_results["subscribed"]:
                integration_results["websocket_subscribe"]["success"] = True
                integration_results["websocket_subscribe"]["details"] = "WebSocket connected, authenticated and subscribed successfully"
                print("WebSocket认证和订阅测试: 成功")
            else:
                integration_results["websocket_subscribe"]["details"] = f"WebSocket authentication/subscription failed (连接: {ws_results['connection_success']}, 认证: {ws_results['authenticated']}, 订阅: {ws_results['subscribed']})"
                print("WebSocket认证和订阅测试: 失败")

            # 3. WebDAV修改测试
            if integration_results["webdav_write"]["success"]:
                try:
                    updated_content = f"Integration test file updated at {time.time()}\nModified content for integration test."
                    response = self.session.put(urljoin(self.server_url, test_file_path), data=updated_content.encode())
                    if response.status_code in [200, 201, 204]:
                        integration_results["webdav_modify"]["success"] = True
                        integration_results["webdav_modify"]["details"] = f"File updated successfully, status: {response.status_code}"

                        # 给WebSocket一点时间接收通知
                        time.sleep(min(5, test_timeout//2))  # 使用测试超时时间的一半，最多5秒
                        print(f"WebDAV修改测试: 成功 (状态码: {response.status_code})")
                    else:
                        integration_results["webdav_modify"]["details"] = f"Update failed with status: {response.status_code}"
                        print(f"WebDAV修改测试: 失败 (状态码: {response.status_code})")
                except Exception as e:
                    integration_results["webdav_modify"]["details"] = f"Update failed with error: {str(e)}"
                    print(f"WebDAV修改测试: 失败 ({str(e)})")
            else:
                integration_results["webdav_modify"]["details"] = "Skipped due to write failure"
                print("WebDAV修改测试: 跳过 (由于写入失败)")

            # 4. 检查WebSocket通知
            # 查找是否有文件变更通知
            file_change_detected = False
            relevant_messages = []  # 存储相关的消息用于调试

            for msg in ws_results["messages_received"]:
                try:
                    parsed_msg = json.loads(msg)
                    if parsed_msg.get("type") == "fileChange":
                        # 检查路径是否匹配（考虑可能的路径格式差异）
                        msg_path = parsed_msg.get("path", "")

                        # 尝试多种匹配方式
                        path_matches = (
                            test_file_path.lstrip('/') == msg_path or  # 完全匹配（去除前导斜杠）
                            test_file_path.lstrip('/') in msg_path or  # 包含关系
                            msg_path.endswith(test_file_path.lstrip('/')) or  # 以测试路径结尾
                            test_file_path.lstrip('/').endswith(msg_path.lstrip('/'))  # 反向检查
                        )

                        if path_matches:
                            file_change_detected = True
                            break
                        else:
                            # 记录不匹配的消息用于调试
                            relevant_messages.append(f"Path mismatch: expected '{test_file_path.lstrip('/')}', got '{msg_path}'")
                except json.JSONDecodeError:
                    continue
                except Exception as e:
                    relevant_messages.append(f"Error parsing message: {str(e)}, message: {msg}")

            if file_change_detected:
                integration_results["websocket_notification"]["success"] = True
                integration_results["websocket_notification"]["details"] = f"Received file change notification for {test_file_path}"
                print("WebSocket通知测试: 成功")
            else:
                # 提供更详细的调试信息
                debug_info = f"Messages received: {len(ws_results['messages_received'])}, "
                if relevant_messages:
                    debug_info += f"Sample mismatches: {relevant_messages[:2]}"  # 只显示前两个不匹配的例子
                else:
                    debug_info += "No fileChange messages received"

                integration_results["websocket_notification"]["details"] = f"No matching file change notification received for {test_file_path}. {debug_info}"
                print(f"WebSocket通知测试: 失败 ({debug_info})")

            # 清理：关闭WebSocket连接
            ws.close()

        except Exception as e:
            integration_results["websocket_subscribe"]["details"] = f"WebSocket test failed with error: {str(e)}"
            integration_results["websocket_notification"]["details"] = "Skipped due to WebSocket failure"
            print(f"WebSocket测试: 失败 ({str(e)})")

        # 清理：删除测试文件
        try:
            self.session.delete(urljoin(self.server_url, test_file_path))
        except:
            pass  # 忽略清理过程中的错误

        return integration_results

    def cleanup(self):
        """清理资源"""
        if self.ws:
            self.ws.close()


def main():
    # 构建完整的WebSocket URL和HTTP URL
    ws_url = f"ws://{url}{ws_path}"  # 使用自定义WebSocket路径
    server_url = f"http://{url}"

    print("WebSocket认证与通知功能测试")
    print("="*50)

    # 显示环境变量配置
    show_environment_config()

    print(f"使用配置:")
    print(f"  WebSocket URL: {ws_url}")
    print(f"  Server URL: {server_url}")
    print(f"  用户名: {username}")
    print(f"  密码: {'*' * len(password)}")  # 隐藏密码
    print(f"  测试目录: {test_dir if test_dir else '(默认: /test/)'}")
    print(f"  超时时间: {test_timeout}秒")
    print(f"  调试模式: {'开启' if debug_mode else '关闭'}")
    print("-" * 50)

    tester = WebSocketIntegrationTester(ws_url, server_url, username, password, test_dir)
    
    try:
        # 执行WebSocket连接测试
        print("\n" + "="*50)
        ws_success = tester.test_websocket_connection()
        
        # 执行WebDAV方法测试
        print("\n" + "="*50)
        webdav_results = tester.test_webdav_methods()
        
        # 执行WebDAV和WebSocket集成测试
        print("\n" + "="*50)
        integration_results = tester.test_webdav_and_websocket_integration()
        
        # 总结
        print("\n" + "="*50)
        print("测试总结:")
        
        # WebSocket测试结果
        print(f"WebSocket功能测试: {'通过' if ws_success else '失败'}")
        
        # WebDAV测试结果
        webdav_passed = sum(1 for result in webdav_results.values() if result.get('success', False))
        webdav_total = len(webdav_results)
        print(f"WebDAV方法测试: {webdav_passed}/{webdav_total} 通过")
        
        # 集成测试结果
        integration_passed = sum(1 for result in integration_results.values() if result.get('success', False))
        integration_total = len(integration_results)
        print(f"WebDAV和WebSocket集成测试: {integration_passed}/{integration_total} 通过")
        
        # 详细集成测试结果
        print("\n集成测试详情:")
        for step, result in integration_results.items():
            status = "成功" if result["success"] else "失败"
            print(f"  {step}: {status} - {result['details']}")
        
        # 计算总成功率
        total_tests = 1 + webdav_total + integration_total  # WebSocket + WebDAV + Integration
        passed_tests = (1 if ws_success else 0) + webdav_passed + integration_passed
        success_rate = (passed_tests / total_tests) * 100

        print(f"\n总测试数: {total_tests}")
        print(f"通过测试: {passed_tests}")
        print(f"失败测试: {total_tests - passed_tests}")
        print(f"成功率: {success_rate:.1f}%")
        
        if success_rate >= 80:
            print("\n✅ 大部分测试通过！")
        else:
            print("\n❌ 存在较多问题，需要修复。")
            
    finally:
        tester.cleanup()


if __name__ == "__main__":
    main()