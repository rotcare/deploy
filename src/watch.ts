import * as memCloud from '@rotcare/cloud-mem';
import { deployFrontend } from './deployFrontend';
import { buildModel, Project } from '@rotcare/project';
import { Cloud } from '@rotcare/cloud';
import { deployBackend } from './deployBackend';

export async function watch(projectDir: string) {
    const cloud = await memCloud.startCloud();
    const project = new Project(projectDir);
    project.startWatcher(deploy.bind(undefined, cloud, project));
}

let deploying: Promise<any> | undefined;
let changedFiles: string[] = [];

function deploy(cloud: Cloud, project: Project, changedFile?: string) {
    if (deploying) {
        if (changedFile) {
            changedFiles.push(changedFile);
        }
        return;
    }
    if (changedFile) {
        console.log(`detected ${changedFile} changed, trigger re-deploying...`);
    }
    changedFiles.length = 0;
    const promises: Promise<any>[] = [
        deployFrontend(cloud, project).catch((e) => {
            console.error(`deployFrontend failed`, e);
        }),
        deployBackend(cloud, project).catch((e) => {
            console.error(`deployBackend failed`, e);
        }),
    ];
    for (const qualifiedName of project.toBuild) {
        if (!project.buildFailed.has(qualifiedName)) {
            promises.push(
                buildModel({ project, qualifiedName }).catch((e) => {
                    console.error('buildModel failed', e);
                }),
            );
        }
    }
    deploying = Promise.all(promises);
    deploying.finally(() => {
        deploying = undefined;
        if (changedFiles.length > 0 || project.toBuild.size > 0) {
            // some file changed during deploying
            deploy(cloud, project);
        }
    });
    return;
}
