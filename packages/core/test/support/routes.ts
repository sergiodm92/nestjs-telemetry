import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

export interface DeclaredRoute {
  /** GET, POST, DELETE... */
  method: string;
  /** The path under the controller's mount point, `:params` included: '/api/entries/:uuid'. */
  path: string;
}

/** The route table of a controller, read from the metadata its decorators wrote. */
export function controllerRoutes(controller: Function): DeclaredRoute[] {
  const prefix: string = Reflect.getMetadata(PATH_METADATA, controller) ?? '/';
  const prototype = controller.prototype;
  const routes: DeclaredRoute[] = [];

  for (const name of Object.getOwnPropertyNames(prototype)) {
    if (name === 'constructor') continue;
    const handler = prototype[name];
    const method: RequestMethod | undefined = Reflect.getMetadata(METHOD_METADATA, handler);
    if (method === undefined) continue;
    const handlerPath: string = Reflect.getMetadata(PATH_METADATA, handler);
    routes.push({ method: RequestMethod[method], path: joinPaths(prefix, handlerPath) });
  }
  return routes;
}

function joinPaths(...parts: string[]): string {
  return '/' + parts.join('/').split('/').filter(Boolean).join('/');
}
