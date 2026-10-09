"""SkyTrans 纯本地视景仿真 SDK，不是飞行控制接口。"""
from .protocol import MOTOR_IDS, PROTOCOL, SURFACE_IDS, ProtocolError
from .client import Client, RemoteError, ApplicationTimeout

__all__ = ["Client", "RemoteError", "ApplicationTimeout", "ProtocolError", "PROTOCOL", "MOTOR_IDS", "SURFACE_IDS"]
from .recording import Recording, snapshot_to_patch
__all__ += ["Recording", "snapshot_to_patch"]
