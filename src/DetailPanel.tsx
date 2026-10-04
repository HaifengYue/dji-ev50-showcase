import { RotateCcw, X } from "lucide-react";
import {
  DETAIL_CONTROL_LABELS,
  DETAIL_LIMITS,
  DETAIL_VIEWS,
  type DetailControl,
  type DetailPose,
  type DetailView,
} from "./details";

export default function DetailPanel({
  view,
  pose,
  onSelect,
  onChange,
  onClose,
  onNeutral,
}: {
  view: DetailView;
  pose: DetailPose;
  onSelect: (view: DetailView) => void;
  onChange: (control: DetailControl, degrees: number) => void;
  onClose: () => void;
  onNeutral: () => void;
}) {
  const selected = DETAIL_VIEWS.find((item) => item.id === view)!;
  return (
    <aside
      className="inspection-context detail-context"
      aria-label="细节检查控制"
    >
      <div className="detail-header">
        <span>细节检查</span>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="关闭细节检查"
        >
          <X size={16} />
        </button>
      </div>
      <div className="detail-tabs" role="group" aria-label="选择细节部件">
        {DETAIL_VIEWS.map((item) => (
          <button
            key={item.id}
            aria-pressed={view === item.id}
            onClick={() => onSelect(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <p>{selected.description}</p>
      {view === "systems" && (
        <p className="detail-flow">
          直流输入 → 电调 → 三相输出 → 无刷电机 → 轴端
          <br />
          功能连接示意，非真实线束走向。
        </p>
      )}
      {selected.controls.length > 0 ? (
        <>
          <span className="detail-caution">示意偏转 · 非实飞控制律</span>
          {selected.controls.map((control) => (
            <label className="detail-control" key={control}>
              <span>
                {DETAIL_CONTROL_LABELS[control]}
                <strong>{pose[control].toFixed(1)}°</strong>
              </span>
              <input
                className="scrubber"
                aria-label={DETAIL_CONTROL_LABELS[control]}
                aria-valuetext={`${pose[control].toFixed(1)}度，模型示意行程`}
                type="range"
                min={DETAIL_LIMITS[control][0]}
                max={DETAIL_LIMITS[control][1]}
                step="0.5"
                value={pose[control]}
                onChange={(event) =>
                  onChange(control, Number(event.target.value))
                }
                style={
                  {
                    "--progress": `${((pose[control] - DETAIL_LIMITS[control][0]) / (DETAIL_LIMITS[control][1] - DETAIL_LIMITS[control][0])) * 100}%`,
                  } as React.CSSProperties
                }
              />
            </label>
          ))}
          <button className="detail-neutral" onClick={onNeutral}>
            <RotateCcw size={13} />
            {view === "cargo" ? "关闭舱盖" : "舵面回中"}
          </button>
        </>
      ) : (
        <span className="detail-caution">
          {view === "systems" ? "独立示意 · 非精确拆机" : "静态外形检查"}
        </span>
      )}
      {view === "cargo" && (
        <small className="detail-lift-note">
          悬空检视 · 为舱盖留出下方空间
        </small>
      )}
      <small>飞行与整翼已暂停。切换部件或离开检查，舵面回中、舱盖关闭。</small>
    </aside>
  );
}
