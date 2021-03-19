import { Cloud } from '@rotcare/cloud';
import * as esbuild from 'esbuild';
import { buildModel, esbuildPlugin, Project } from '@rotcare/project';
import * as path from 'path';
import * as fs from 'fs';
import * as vm from 'vm';

let result: esbuild.BuildIncremental;

export async function deployBackend(cloud: Cloud, project: Project) {
    if (!fs.existsSync(path.join(project.projectDir, 'src/backend.ts'))) {
        return;
    }
    if (result) {
        result = await result.rebuild();
    } else {
        for (const qualifiedName of listBackendQualifiedNames(project)) {
            buildModel({ project, qualifiedName });
        }
        result = await (esbuild.build({
            sourcemap: 'inline',
            keepNames: true,
            bundle: true,
            entryPoints: ['@motherboard/backend'],
            platform: 'node',
            format: 'cjs',
            write: false,
            absWorkingDir: project.projectDir,
            plugins: [esbuildPlugin({ project })],
            incremental: true,
        }) as Promise<esbuild.BuildIncremental>);
    }
    if (project.toBuild.size > 0) {
        project.toBuild.add('backend');
        return;
    }
    const bundledCode = result.outputFiles![0].text;
    await cloud.serverless.createSharedLayer(bundledCode);
    const functionNames = evalToListFunctionNames(bundledCode);
    for (const functionName of functionNames) {
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
    if (functionNames.includes('migrate')) {
        await cloud.serverless.invokeFunction('migrate');
    }
}

function evalToListFunctionNames(bundledCode: string) {
    const exports: any = {};
    vm.runInNewContext(
        bundledCode,
        vm.createContext({ exports, require: global.require }),
    );
    return Object.keys(exports.httpRpcServers || {});
}

function listBackendQualifiedNames(project: Project) {
    const isBackend = (qualifiedName: string): boolean =>
        qualifiedName.includes('/Private/') || qualifiedName.includes('/Public/');
    return project.listQualifiedNames().filter(isBackend);
}
