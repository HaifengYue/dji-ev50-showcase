import { newMotorCommands } from "./motors";
import type { SimulationRuntime } from "./simulation";
import type { SimulationBridge } from "./simulationBridge";
import type { RecordingLoader } from "./recordingLoader";

/** 只有明确的本地操作才切换驱动；Python 与记录回放始终保有控制权。 */
export function beginLocalControl(
  runtime: SimulationRuntime,
  bridge: SimulationBridge,
  loader: RecordingLoader,
  driver: "demo" | "manual",
) {
  const snapshot = runtime.getSnapshot();
  if (snapshot.control !== "local" || snapshot.disposed) return false;
  loader.cancel();
  // 取消尚在等待旧连接清理的接入意图，不复位当前机体状态。
  void bridge.close(false);
  return runtime.setLocal(
    {
      time: { paused: driver === "demo" },
      ...(snapshot.driver !== driver ? { motors: newMotorCommands() } : {}),
    },
    driver,
  );
}

/** Escape 仅处理可见界面层；释放 Python 必须点击明确的退出入口。 */
export function escapeTarget({
  modal,
  menu,
  drive,
  detail,
}: {
  modal: boolean;
  menu: boolean;
  drive: boolean;
  detail: boolean;
}) {
  if (modal) return "modal";
  if (menu) return "menu";
  if (drive) return "drive";
  if (detail) return "detail";
  return null;
}
