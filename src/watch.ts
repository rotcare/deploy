import * as memCloud from '@stableinf/cloud-mem';
import { deployFrontend } from './deployFrontend';
import { Project } from './Project';
import { Cloud } from '@stableinf/cloud';

export async function watch(projectDir: string) {
    console.log(process.cwd())
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
    const promises = [
        deployFrontend(cloud, project).catch((e) => {
            console.error(`deployFrontend failed: ${e}`);
        }),
        // deployBackend(cloud, project).catch((e) => {
        //     console.error(`deployBackend failed: ${e}`);
        // }),
    ];
    deploying = Promise.all(promises);
    deploying.finally(() => {
        deploying = undefined;
        if (changedFiles.length > 0) {
            // some file changed during deploying
            deploy(cloud, project);
        }
    });
    return;
}
