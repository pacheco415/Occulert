import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{isUuid,numberOrNull,integerOrNull,validJsonBody}=require('../api/_lib/validation.js');
test('UUID validation never coerces client values',()=>{
 assert.equal(isUuid('f89d1cf9-893f-4fb6-a924-6669b4568221'),true);assert.equal(isUuid('F89D1CF9-893F-4FB6-A924-6669B4568221'),true);
 for(const value of [null,undefined,{},[],1,'','not-a-uuid',' f89d1cf9-893f-4fb6-a924-6669b4568221'])assert.equal(isUuid(value),false);
 const uuid='f89d1cf9-893f-4fb6-a924-6669b4568221';
 for(const value of [new String(uuid),[uuid],Symbol('uuid'),uuid+'\n',uuid+'\0',uuid+' ',uuid+'.extra'])assert.equal(isUuid(value),false);
});
test('finite metrics preserve zeros, clamp bounds and do not coerce missing values',()=>{
 for(const value of [null,undefined,true,false,{},[],Infinity,NaN,'', ' ',Symbol('invalid')])assert.equal(numberOrNull(value,0,100),null);
 assert.equal(numberOrNull(0,0,100),0);assert.equal(numberOrNull('12.5',0,100),12.5);assert.equal(numberOrNull(-10,0,100),0);assert.equal(numberOrNull(200,0,100),100);
 assert.equal(integerOrNull(2.7),3);assert.equal(integerOrNull(20000),10000);assert.equal(integerOrNull(''),null);
 assert.equal(numberOrNull('0',0,100),0);assert.equal(numberOrNull('-90',-90,90),-90);assert.equal(numberOrNull('90',-90,90),90);
 for(const value of ['Infinity','NaN','not a number',1n,new Number(1)])assert.equal(numberOrNull(value,0,100),null);
 for(const [input,expected] of [[0,0],['0',0],[-0.5,0],[0.49,0],[0.5,1],[9999.49,9999],[9999.5,10000],[10000,10000]])assert.equal(integerOrNull(input),expected);
 for(const value of [null,undefined,true,false,{},[],Infinity,NaN,' '])assert.equal(integerOrNull(value),null);
});
test('JSON requests require an exact media type, an object and a bounded serializable body',()=>{
 const request=(body,type='application/json')=>({body,headers:{'content-type':type}});
 assert.equal(validJsonBody(request({})),true);assert.equal(validJsonBody(request({},' Application/JSON ; charset=utf-8')),true);
 for(const body of [null,undefined,[],1,true,'{}'])assert.equal(validJsonBody(request(body)),false);
 for(const type of ['','text/plain','not-application/json','application/jsonp'])assert.equal(validJsonBody(request({},type)),false);
 assert.equal(validJsonBody(request({long:'12345'}),5),false);const cyclic={};cyclic.self=cyclic;assert.equal(validJsonBody(request(cyclic)),false);
 assert.equal(validJsonBody(request({value:'1234'}),16),true);assert.equal(validJsonBody(request({value:'1234'}),15),false);
 assert.equal(validJsonBody({body:{},headers:{}}),false);assert.equal(validJsonBody({body:{}}),false);
 assert.equal(validJsonBody(request({integer:1n})),false);
});

test('shared route responses retain status, existing method headers, JSON values and no-store policy',()=>{
 const {json}=require('../api/_lib/responses.js'),headers={'Allow':'POST'};
 const response={setHeader:(name,value)=>{headers[name]=value},end(value){this.body=value}};
 json(response,409,{ok:false,error:'conflict',recorded:0,missing:null,message:'Confirmed ✓'});
 assert.equal(response.statusCode,409);assert.equal(headers.Allow,'POST');
 assert.equal(headers['Content-Type'],'application/json; charset=utf-8');assert.equal(headers['Cache-Control'],'no-store');
 assert.deepEqual(JSON.parse(response.body),{ok:false,error:'conflict',recorded:0,missing:null,message:'Confirmed ✓'});
});
