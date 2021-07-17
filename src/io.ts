import { vec3 } from 'gl-matrix';
import vtkStr from './solution.vtk';

type Cell = {
    points: number[]
}

type Dataset = {
    points: vec3[],
    cells: Cell[],
    point_data?: vec3[]
}

function readArray(nValues: number, tokens: string[]): number[] {
    let result: number[] = [];
    for (let i=0; i<nValues; ++i) {
        result.push(+tokens.shift());
    }
    return result;
}

function readPoints(tokens: string[]): vec3[] {
    console.log(tokens.shift());  // POINTS
    var nPoints = +tokens.shift();
    console.log(tokens.shift());  // double

    let result: vec3[] = []
    for (let i=0; i<nPoints; ++i) {
        result.push([+tokens.shift(), +tokens.shift(), +tokens.shift()])
    }

    return result;
}

function readCells(tokens: string[]): Cell[] {
    console.log(tokens.shift());  // CELLS
    var nCells = +tokens.shift();
    var nValues = +tokens.shift();

    let result: Cell[] = []
    for (let i=0; i<nCells; ++i) {
        const nPoints = +tokens.shift();
        result.push({points: readArray(nPoints, tokens)});
    }

    console.log(tokens.shift());  // CELL_TYPES
    var nPoints = +tokens.shift();
    for (let i=0; i<nPoints; ++i) {
        tokens.shift();
    }

    return result;
}

function readPointData(tokens: string[]): vec3[] {
    console.log(tokens.shift());  // POINT_DATA
    var nPoints = +tokens.shift();
    console.log(tokens.shift());  // VECTORS
    const name = tokens.shift();
    console.log(tokens.shift());  // double
    let result: vec3[] = []
    for (let i=0; i<nPoints; ++i) {
        result.push([+tokens.shift(), +tokens.shift(), +tokens.shift()])
    }

    return result;
}

export function load(): Dataset {
    var lines = vtkStr.split('\n');
    lines.shift();
    lines.shift();
    console.log(lines.shift());  // ASCII

    var tokens:string[] = lines.flatMap((s:string) => s.trim().split(/\s+/)).filter((s:string) => s != '');

    console.log(tokens.shift());  // DATASET
    console.log(tokens.shift());  // UNSTRUCTURED_GRID

    const points = readPoints(tokens);
    const cells = readCells(tokens);
    const data = readPointData(tokens);

    return {
        points: points,
        cells:cells,
        point_data: data
    }
}
