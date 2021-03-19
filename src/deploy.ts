import { watch, Project } from '@rotcare/project';
import * as memCloud from '@rotcare/cloud-mem';
import { deployBackend } from './deployBackend';
import { deployFrontend } from './deployFrontend';

export async function deploy(projectDir: string) {
    const cloud = await memCloud.startCloud();
    const project = new Project(projectDir);
    watch(project, async () => {
        await Promise.all([deployBackend(cloud, project), deployFrontend(cloud, project)]);
    });
}
