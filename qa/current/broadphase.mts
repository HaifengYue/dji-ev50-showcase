/** 必须包含原 SAT 1e-9 容差范围，不能以严格包围盒排除容差接触。 */
export function conservativeBoxesOverlap(a:any,b:any,epsilon=1e-9){return ['x','y','z'].every(k=>a.min[k]<=b.max[k]+epsilon&&b.min[k]<=a.max[k]+epsilon);}
