import { Archetype, ModelProperty } from '@rotcare/codegen';
import * as babel from '@babel/types';
import * as path from 'path';
import generate from '@babel/generator';

export function mergeClassDecls(
    qualifiedName: string,
    archetype: Archetype | undefined,
    classDecls: babel.ClassDeclaration[],
    properties: ModelProperty[],
): babel.ClassDeclaration {
    const methods = new Map<string, babel.ClassMethod>();
    const others = [];
    if (archetype === 'ActiveRecord') {
        const tableName = path.basename(qualifiedName);
        others.push(
            babel.classProperty(
                babel.identifier('tableName'),
                babel.stringLiteral(tableName),
                undefined,
                undefined,
                false,
                true,
            ),
        );
    }
    for (const classDecl of classDecls) {
        for (const member of classDecl.body.body) {
            if (!babel.isClassMethod(member)) {
                if (babel.isClassProperty(member) && babel.isIdentifier(member.key) && babel.isTSTypeAnnotation(member.typeAnnotation)) {
                    properties.push({
                        name: member.key.name,
                        type: generate(member.typeAnnotation.typeAnnotation).code,
                        readonly: !!member.readonly,
                    });
                }
                others.push(member);
                continue;
            }
            if (babel.isIdentifier(member.key)) {
                const baseMethod = methods.get(member.key.name);
                if (baseMethod) {
                    if (!hasVirtualTag(baseMethod)) {
                        throw new Error(
                            `must use @virtual tsdoc comment to mark a method as interface: ${member.key.name}`,
                        );
                    }
                    if (!hasOverrideTag(member)) {
                        throw new Error(
                            `must use @override tsdoc comment to implement virtual method: ${member.key.name}`,
                        );
                    }
                }
                methods.set(member.key.name, { ...member, decorators: [] });
            } else {
                others.push(member);
            }
        }
    }
    return {
        ...classDecls[0],
        body: { ...classDecls[0].body, body: [...others, ...methods.values()] },
    };
}

function hasOverrideTag(method: babel.ClassMethod) {
    if (!method.leadingComments) {
        return false;
    }
    for (const comment of method.leadingComments) {
        if (comment.value.includes('@override')) {
            return true;
        }
    }
    return false;
}

function hasVirtualTag(method: babel.ClassMethod) {
    if (!method.leadingComments) {
        return false;
    }
    for (const comment of method.leadingComments) {
        if (comment.value.includes('@virtual')) {
            return true;
        }
    }
    return false;
}
