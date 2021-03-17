import { Cloud, SERVERLESS_TYPE } from '@rotcare/cloud';
import * as esbuild from 'esbuild';
import { buildModel, esbuildPlugin } from './buildModel/buildModel';
import { Project } from './Project';
import * as path from 'path';
import * as fs from 'fs';

let result: esbuild.BuildIncremental;

export async function deployBackend(cloud: Cloud, project: Project) {
    if (result) {
        result = await result.rebuild();
    } else {
        const promises = [];
        for (const qualifiedName of listBackendQualifiedNames(project)) {
            promises.push(buildModel(project, qualifiedName));
        }
        await Promise.all(promises);
        result = await (esbuild.build({
            sourcemap: 'inline',
            keepNames: true,
            bundle: true,
            entryPoints: ['@motherboard/backend'],
            platform: 'node',
            format: 'cjs',
            write: false,
            absWorkingDir: project.projectDir,
            plugins: [esbuildPlugin(project)],
            incremental: true,
        }) as Promise<esbuild.BuildIncremental>);
        return;
    }
    const bundledCode = result.outputFiles![0].text;
    await cloud.serverless.createSharedLayer(bundledCode);
    await cloud.serverless.createFunction('migrate');
    for (const functionName of evalToListFunctionNames(bundledCode)) {
            await cloud.serverless.createFunction(functionName);
            await cloud.apiGateway.createRoute({
                path: `/${functionName}`,
                httpMethod: 'POST',
                functionName,
            });
    }
    await cloud.apiGateway.reload({
        projectPackageName: project.projectPackageName,
    });
    await cloud.serverless.invokeFunction('migrate');
}

function evalToListFunctionNames(bundledCode: string) {
    const SERVERLESS: SERVERLESS_TYPE = { } as any;
    eval(bundledCode);
    return Object.keys(SERVERLESS.functions);
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
