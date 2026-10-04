/** 静态解析实际本地模块边；省略扩展名不能令冻结闭包漏掉传递依赖。 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';

const extensions=['.ts','.tsx','.mts','.mjs','.js','.jsx','.cts','.cjs','.json'];
const isLocal=specifier=>specifier==='.'||specifier==='..'||specifier.startsWith('./')||specifier.startsWith('../');
const isFile=file=>fs.existsSync(file)&&fs.statSync(file).isFile();

export function resolveLocalModule(importer,specifier,fileExists=isFile){
 assert(isLocal(specifier),'只能解析本地模块 '+specifier);
 const stem=path.normalize(path.join(path.dirname(importer),specifier));
 const candidates=[stem];
 if(!path.extname(stem)){
  candidates.push(...extensions.map(extension=>stem+extension));
  candidates.push(...extensions.map(extension=>path.join(stem,'index'+extension)));
 }else{
  // tsx允许源码以将来的JavaScript扩展名引用对应TypeScript模块。
  const typed={'.js':['.ts','.tsx'],'.jsx':['.tsx'],'.mjs':['.mts'],'.cjs':['.cts']}[path.extname(stem)]??[];
  candidates.push(...typed.map(extension=>stem.slice(0,-path.extname(stem).length)+extension));
 }
 const resolved=candidates.find(fileExists);
 assert(resolved,`缺少实际本地模块 ${importer} -> ${specifier}`);
 return resolved;
}

export function localModuleDependencies(importer,source,fileExists=isFile){
 const ast=ts.createSourceFile(importer,source,ts.ScriptTarget.Latest,true),specifiers=new Set();
 const record=node=>{if(node&&ts.isStringLiteralLike(node)&&isLocal(node.text))specifiers.add(node.text);};
 function visit(node){
  if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node))record(node.moduleSpecifier);
  if(ts.isImportEqualsDeclaration(node)&&ts.isExternalModuleReference(node.moduleReference))record(node.moduleReference.expression);
  if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||(ts.isIdentifier(node.expression)&&['require','tsImport'].includes(node.expression.text))))record(node.arguments[0]);
  ts.forEachChild(node,visit);
 }
 visit(ast);
 return [...new Set([...specifiers].map(specifier=>resolveLocalModule(importer,specifier,fileExists)))];
}
