import { Cloud } from '@rotcare/cloud';
import * as esbuild from 'esbuild';
import { esbuildPlugin, listBuiltModels } from './buildModel';
import { Project } from './Project';
import * as path from 'path';
import * as fs from 'fs';

let result: esbuild.BuildIncremental;
let backendJs = '';

export async function deployBackend(cloud: Cloud, project: Project) {
    if (!backendJs) {
        backendJs = generateBackend(project);
    }
    if (result) {
        result = await result.rebuild();
    } else {
        result = await (esbuild.build({
            sourcemap: 'inline',
            keepNames: true,
            bundle: true,
            stdin: {
                contents: `require('@backend');`,
            },
            platform: 'node',
            format: 'cjs',
            write: false,
            absWorkingDir: project.projectDir,
            plugins: [
                esbuildPlugin(project),
                {
                    name: '@backend provider',
                    setup: (build) => {
                        build.onResolve({ filter: /^@backend/ }, (args) => {
                            return { path: args.path, namespace: '@backend' };
                        });
                        build.onLoad(
                            { namespace: '@backend', filter: /^@backend/ },
                            async (args) => {
                                return {
                                    resolveDir: project.projectDir,
                                    contents: backendJs,
                                    loader: 'js',
                                };
                            },
                        );
                    },
                },
            ],
            incremental: true,
        }) as Promise<esbuild.BuildIncremental>);
        return;
    }
    const newBackendJs = generateBackend(project);
    if (newBackendJs !== backendJs) {
        backendJs = newBackendJs;
        project.onChange('@backend');
        return;
    }
    await cloud.serverless.createSharedLayer(result.outputFiles![0].text);
    for (const model of listBuiltModels()) {
        for (const service of model.services) {
            await cloud.serverless.createFunction(service);
            await cloud.apiGateway.createRoute({
                path: `/${service}`,
                httpMethod: 'POST',
                functionName: service,
            });
        }
    }
    await cloud.apiGateway.reload({
        projectPackageName: project.projectPackageName,
    });
}

// watch fs and dump bakcend services into serverlessFunctions.js
function generateBackend(project: Project) {
    const lines = [
        `
const { Impl, Scene } = require('@rotcare/io');
SERVERLESS.sceneConf = {
    database: new Impl.InMemDatabase(),
    serviceProtocol: undefined,
};`,
    ];
    for (const qualifiedName of listBackendQualifiedNames(project)) {
        lines.push(`require('@motherboard/${qualifiedName}');`);
    }
    const models = listBuiltModels();
    models.sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName));
    for (const model of models) {
        for (const service of model.services) {
            const className = path.basename(model.qualifiedName);
            lines.push(
                [
                    `SERVERLESS.functions.${service} = new Impl.HttpRpcServer(SERVERLESS, `,
                    `() => import('@motherboard/${model.qualifiedName}'), `,
                    `'${className}', '${service}').handler;`,
                ].join(''),
            );
        }
    }
    return lines.join('\n');
}

function listBackendQualifiedNames(project: Project) {
    const qualifiedNames = [];
    for (const pkg of project.packages) {
        project.subscribePath(path.join(pkg.path, 'package.json'));
        const srcDir = path.join(pkg.path, 'src');
        project.subscribePath(srcDir);
        for (const srcFile of walk(srcDir)) {
            const ext = path.extname(srcFile);
            if (!['.ts', '.js', '.tsx', '.jsx'].includes(ext)) {
                continue;
            }
            const relPath = path.relative(srcDir, srcFile);
            const dotPos = relPath.indexOf('.');
            const qualifiedName = relPath.substr(0, dotPos);
            if (qualifiedName.includes('/Private/') || qualifiedName.includes('/Public/')) {
                qualifiedNames.push(qualifiedName);
            }
        }
    }
    return qualifiedNames;
}

function* walk(filePath: string): Generator<string> {
    try {
        for (const dirent of fs.readdirSync(filePath)) {
            if (dirent.startsWith('.')) {
                continue;
            }
            yield* walk(path.join(filePath, dirent));
        }
    } catch (e) {
        yield filePath;
    }
}
