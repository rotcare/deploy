import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';
import { parse } from '@babel/parser';
import * as babel from '@babel/types';
import generate from '@babel/generator';
import { fromObject } from 'convert-source-map';
import { Project } from '../Project';
import { Archetype, Model, ModelMethod, ModelProperty } from '@rotcare/codegen';
import * as esbuild from 'esbuild';
import { mergeClassDecls } from './mergeClassDecls';
import { mergeImports } from './mergeImports';
import { expandCodegen } from './expandCodegen';

const lstat = promisify(fs.lstat);
const readFile = promisify(fs.readFile);
const cache = new Map<string, ModelCache>();

export interface ModelCache extends Model {
    code: string;
    hash: number;
    isTsx: boolean;
    resolveDir: string;
}

interface SrcFile {
    package: string;
    fileName: string;
    content: string;
}

// @motherboard 开头的路径都是由这个 esbuildPlugin 虚构出来的
// 其源代码来自于 project 的多个 packages 合并而来
export function esbuildPlugin(project: Project): esbuild.Plugin {
    return {
        name: 'rotcare',
        setup: (build) => {
            build.onResolve({ filter: /^[^.]/ }, (args) => {
                if (args.path.startsWith('@motherboard/')) {
                    return { path: args.path, namespace: '@motherboard' };
                } else {
                    project.subscribePackage(args.path);
                    return undefined;
                }
            });
            build.onLoad({ namespace: '@motherboard', filter: /^@motherboard\// }, async (args) => {
                const model = await buildModel(project, args.path.substr('@motherboard/'.length));
                return {
                    resolveDir: model.resolveDir,
                    contents: model.code,
                    loader: model.isTsx ? 'tsx' : 'ts',
                };
            });
        },
    };
}

export async function buildModel(project: Project, qualifiedName: string) {
    const { hash, srcFiles, resolveDir } = await locateSrcFiles(project.packages, qualifiedName);
    if (srcFiles.size === 0) {
        throw new Error(`referenced ${qualifiedName} not found`);
    }
    let model = cache.get(qualifiedName);
    if (model && model.hash === hash) {
        return model;
    }
    const imports: babel.ImportDeclaration[] = [];
    const others: babel.Statement[] = [];
    const classDecls: babel.ClassDeclaration[] = [];
    const className = path.basename(qualifiedName);
    for (const [srcFilePath, srcFile] of srcFiles.entries()) {
        srcFile.content = (await readFile(srcFilePath)).toString();
        const ast = parse(srcFile.content, {
            plugins: [
                'typescript',
                'jsx',
                'classProperties',
                ['decorators', { decoratorsBeforeExport: true }],
            ],
            sourceType: 'module',
            sourceFilename: srcFilePath,
        });
        extractStatements(className, ast, { imports, others, classDecls });
    }
    const symbols = new Map<string, string>();
    const mergedStmts: babel.Statement[] = mergeImports(qualifiedName, imports, symbols);
    for (const other of others) {
        try {
            mergedStmts.push(expandCodegen(project, other, imports, symbols, cache));
        } catch (e) {
            console.error(`failed to generate code: ${(other.loc as any).filename}`, e);
            mergedStmts.push(other);
        }
    }
    let archetype: Archetype | undefined;
    const properties: ModelProperty[] = [];
    const staticProperties: ModelProperty[] = [];
    const methods: ModelMethod[] = [];
    const staticMethods: ModelMethod[] = [];
    if (classDecls.length > 0) {
        if (babel.isIdentifier(classDecls[0].superClass)) {
            archetype = classDecls[0].superClass.name as Archetype;
        }
        const mergedClassDecl = mergeClassDecls({
            qualifiedName,
            archetype,
            classDecls,
            model: { properties, staticProperties, methods, staticMethods },
        });
        mergedStmts.push(babel.exportNamedDeclaration(mergedClassDecl, []));
    }
    const merged = babel.file(babel.program(mergedStmts, undefined, 'module'));
    const { code, map } = generate(merged, { sourceMaps: true });
    if (!map) {
        throw new Error('missing map');
    }
    map.sourcesContent = [];
    let isTsx = false;
    for (const [i, srcFilePath] of map.sources.entries()) {
        if (srcFilePath.endsWith('.tsx')) {
            isTsx = true;
        }
        const srcFile = srcFiles.get(srcFilePath)!;
        map.sources[i] = `@motherboard/${srcFile.package}/${srcFile.fileName}`;
        map.sourcesContent.push(srcFile.content);
    }
    model = {
        qualifiedName,
        code: `${code}\n${fromObject(map).toComment()}`,
        hash,
        isTsx,
        resolveDir,
        archetype: archetype!,
        properties,
        staticProperties,
        methods,
        staticMethods,
    };
    cache.set(qualifiedName, model);
    return model;
}

async function locateSrcFiles(packages: { name: string; path: string }[], qualifiedName: string) {
    const srcFiles = new Map<string, SrcFile>();
    let hash = 0;
    let resolveDir = '';
    for (const pkg of packages) {
        for (const ext of ['.ts', '.tsx', '.impl.ts', '.impl.tsx']) {
            const fileName = `${qualifiedName}${ext}`;
            const filePath = path.join(pkg.path, 'src', fileName);
            try {
                const stat = await lstat(filePath);
                hash += stat.mtimeMs;
                srcFiles.set(filePath, { package: pkg.name, fileName, content: '' });
                if (!resolveDir) {
                    resolveDir = pkg.path;
                }
            } catch (e) {
                hash += 1;
            }
        }
    }
    return { hash, srcFiles, resolveDir } as const;
}

function extractStatements(
    className: string,
    ast: babel.File,
    extractTo: {
        imports: babel.ImportDeclaration[];
        others: babel.Statement[];
        classDecls: babel.ClassDeclaration[];
    },
) {
    for (const stmt of ast.program.body) {
        if (babel.isImportDeclaration(stmt)) {
            extractTo.imports.push(stmt);
        } else if (babel.isExportNamedDeclaration(stmt)) {
            if (
                babel.isClassDeclaration(stmt.declaration) &&
                stmt.declaration.id.name === className
            ) {
                extractTo.classDecls.push(stmt.declaration);
            } else {
                extractTo.others.push(stmt);
            }
        } else {
            extractTo.others.push(stmt);
        }
    }
}
