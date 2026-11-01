function topic(page){
 const trigger=page.getByRole('combobox',{name:'题号',exact:true});
 return {
  selectOption:async value=>{await trigger.click();const label=value==='@new:problem'?'＋ 新建题号…':value||'<无>';await page.getByRole('option').filter({has:page.getByText(label,{exact:true})}).click();},
  inputValue:()=>trigger.getAttribute('data-value'),isDisabled:()=>trigger.isDisabled(),boundingBox:()=>trigger.boundingBox()
 };
}
module.exports={topic};

function project(page){const trigger=page.getByRole('combobox',{name:'实验项目',exact:true});return {selectOption:async value=>{await trigger.click();const label=value==='@new:lab'?'＋ 新建项目…':value||'<无>';await page.getByRole('option').filter({has:page.getByText(label,{exact:true})}).click();},inputValue:()=>trigger.getAttribute('data-value')};}
function zoom(page){const trigger=page.getByRole('combobox',{name:'界面缩放',exact:true});return {selectOption:async value=>{await trigger.click();await page.getByRole('option',{name:Math.round(Number(value)*100)+'%',exact:true}).click();},inputValue:()=>trigger.getAttribute('data-value')};}
module.exports={topic,project,zoom};
