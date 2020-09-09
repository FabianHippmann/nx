import {
  BuilderContext,
  BuilderOutput,
  createBuilder,
} from '@angular-devkit/architect';
import { JsonObject } from '@angular-devkit/core';
import * as ng from '@angular/compiler-cli';
import { resolve } from 'path';
import { from, Observable, of } from 'rxjs';
import { mapTo, switchMap, tap } from 'rxjs/operators';
import {
  calculateProjectDependencies,
  checkDependentProjectsHaveBeenBuilt,
  DependentBuildableProjectNode,
  updateBuildableProjectPackageJsonDependencies,
  updatePaths,
} from '@nrwl/workspace/src/utils/buildable-libs-utils';
import { createProjectGraph } from '@nrwl/workspace/src/core/project-graph';
import {
  NX_PACKAGE_PROVIDERS,
  NX_PACKAGE_TRANSFORM,
} from './nxng-builder/package.di';
import { NgPackagr } from 'ng-packagr';
import { ENTRY_POINT_PROVIDERS } from 'ng-packagr/lib/ng-package/entry-point/entry-point.di';
import { NX_ENTRY_POINT_PROVIDERS } from '@nrwl/angular/src/builders/lib-build/nxng-builder/entry-point.di';

export interface BuildAngularLibraryBuilderOptions {
  /**
   * The file path for the ng-packagr configuration file, relative to the current workspace.
   */
  project: string;
  /**
   * The full path for the TypeScript configuration file, relative to the current workspace.
   */
  tsConfig?: string;
  /**
   * Run build when files change.
   */
  watch?: boolean;

  updateBuildableProjectDepsInPackageJson?: boolean;
}

async function initializeNgPackagr(
  options: BuildAngularLibraryBuilderOptions & JsonObject,
  context: BuilderContext,
  projectDependencies: DependentBuildableProjectNode[]
): Promise<import('ng-packagr').NgPackagr> {
  // const packager = (await import('ng-packagr')).ngPackagr();
  const packager = new NgPackagr([
    // Add default providers to this list.
    ...NX_PACKAGE_PROVIDERS,
    ...NX_ENTRY_POINT_PROVIDERS,
  ]);
  packager.forProject(resolve(context.workspaceRoot, options.project));
  packager.withBuildTransform(NX_PACKAGE_TRANSFORM.provide);

  if (options.tsConfig) {
    // read the tsconfig and modify its path in memory to
    // pass it on to ngpackagr
    const parsedTSConfig = ng.readConfiguration(options.tsConfig);
    updatePaths(projectDependencies, parsedTSConfig.options.paths);
    packager.withTsConfig(parsedTSConfig);
  }

  return packager;
}

export function run(
  options: BuildAngularLibraryBuilderOptions & JsonObject,
  context: BuilderContext
): Observable<BuilderOutput> {
  const projGraph = createProjectGraph();
  const { target, dependencies } = calculateProjectDependencies(
    projGraph,
    context
  );
  return of(checkDependentProjectsHaveBeenBuilt(context, dependencies)).pipe(
    switchMap((result) => {
      if (result) {
        return from(initializeNgPackagr(options, context, dependencies)).pipe(
          switchMap((packager) =>
            options.watch ? packager.watch() : packager.build()
          ),
          tap(() => {
            if (
              dependencies.length > 0 &&
              options.updateBuildableProjectDepsInPackageJson
            ) {
              updateBuildableProjectPackageJsonDependencies(
                context,
                target,
                dependencies
              );
            }
          }),
          mapTo({ success: true })
        );
      } else {
        // just pass on the result
        return of({ success: false });
      }
    })
  );
}

export default createBuilder<Record<string, string> & any>(run);
