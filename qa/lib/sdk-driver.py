"""独立交叉层测试用标准库SDK进程；所有命令由父测试明确指定。"""
import json
import sys
from transwing_sim.client import Client

client = Client(sys.argv[1], client_name='v15-independent-sdk', heartbeat=False)
for line in sys.stdin:
    try:
        request = json.loads(line)
        op = request['op']
        if op == 'connect':
            client.connect()
            result = {'sessionId': client.session_id, 'nextSeq': client.next_seq}
        elif op == 'command':
            result = client.command(request['command'], request.get('payload', {}), wait_applied=request.get('waitApplied', False), timeout=2)
        elif op == 'receipt':
            result = client.receipt(request['seq'])
        elif op == 'snapshot':
            result = client.snapshot()
        elif op == 'ready':
            result = client.ready()
        elif op == 'close':
            result = client.close()
        else:
            raise ValueError('未知测试操作')
        print(json.dumps({'ok': True, 'result': result}), flush=True)
    except Exception as error:
        print(json.dumps({'ok': False, 'type': type(error).__name__, 'error': str(error), 'code': getattr(error, 'code', None)}), flush=True)
client.close()
