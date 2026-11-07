/** Minimale Typen für 'clipper-lib' (reine JS-Portierung von Angus Johnsons Clipper 6.4). */
declare module 'clipper-lib' {
  export interface IntPoint { X: number; Y: number }
  export type Path = IntPoint[]
  export type Paths = Path[]

  export const PolyType: { ptSubject: number; ptClip: number }
  export const ClipType: { ctIntersection: number; ctUnion: number; ctDifference: number; ctXor: number }
  export const PolyFillType: { pftEvenOdd: number; pftNonZero: number; pftPositive: number; pftNegative: number }

  export const JoinType: { jtSquare: number; jtRound: number; jtMiter: number }
  export const EndType: { etOpenSquare: number; etOpenRound: number; etOpenButt: number; etClosedLine: number; etClosedPolygon: number }

  export class ClipperOffset {
    constructor(miterLimit?: number, arcTolerance?: number)
    AddPath(path: Path, joinType: number, endType: number): void
    AddPaths(paths: Paths, joinType: number, endType: number): void
    Execute(solution: Paths, delta: number): void
    Clear(): void
  }

  export class Clipper {
    constructor(initOptions?: number)
    AddPath(path: Path, polyType: number, closed: boolean): boolean
    AddPaths(paths: Paths, polyType: number, closed: boolean): boolean
    Execute(clipType: number, solution: Paths, subjFillType?: number, clipFillType?: number): boolean
    Clear(): void
    static CleanPolygons(polys: Paths, distance?: number): Paths
    static CleanPolygon(poly: Path, distance?: number): Path
    static Area(poly: Path): number
    static Orientation(poly: Path): boolean
  }

  const ClipperLib: {
    Clipper: typeof Clipper
    ClipperOffset: typeof ClipperOffset
    JoinType: typeof JoinType
    EndType: typeof EndType
    PolyType: typeof PolyType
    ClipType: typeof ClipType
    PolyFillType: typeof PolyFillType
  }
  export default ClipperLib
}
