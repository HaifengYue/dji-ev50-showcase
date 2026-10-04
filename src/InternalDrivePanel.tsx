import { X } from "lucide-react";

export default function InternalDrivePanel({
  progress,
  external,
  onClose,
}: {
  progress: number;
  external: boolean;
  onClose: () => void;
}) {
  return (
    <section
      className="inspection-context drive-context"
      aria-label="内部驱动检查"
    >
      <div className="drive-header">
        <span>内部驱动</span>
        <button
          className="icon-button"
          aria-label="关闭内部驱动并恢复外壳"
          title="恢复外壳"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
      <strong>
        {Math.round(progress * 100)}
        <small>% 展开</small>
      </strong>
      <p className="drive-path">
        电机 / 减速箱 → 丝杠 → 滑架与中央横梁 → 左右连杆
      </p>
      <p>
        {external
          ? "随 Python 输入联动；此视图只移开外壳，不改变仿真。"
          : "用下方展开、收拢或进度滑块，检查两侧同步连接。"}
        {" 拖动旋转，滚轮缩放，右键或双指平移。"}
      </p>
      <small>
        内部布局为概念重建，非原厂内部 CAD；齿形仅作运动示意，非加工设计。
      </small>
      <button className="joint-back" onClick={onClose}>
        恢复外壳与普通视图 ↗
      </button>
    </section>
  );
}
