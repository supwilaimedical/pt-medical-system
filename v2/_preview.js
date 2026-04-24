// Shared interactions for V2 previews

function toggleDrawer(){
  var d = document.getElementById('mDrawer');
  var b = document.getElementById('mDrawerBack');
  if(d) d.classList.toggle('open');
  if(b) b.classList.toggle('open');
}

function kebab(e, id){
  e.stopPropagation();
  document.querySelectorAll('.kebab-menu.open').forEach(m=>{ if(m.id !== id) m.classList.remove('open'); });
  var el = document.getElementById(id);
  if(el) el.classList.toggle('open');
}

document.addEventListener('click', function(){
  document.querySelectorAll('.kebab-menu.open').forEach(m=> m.classList.remove('open'));
});

function toggleNav(){
  var n = document.getElementById('dNav');
  if(n) n.classList.toggle('expanded');
}

// chip toggle for demo
document.addEventListener('DOMContentLoaded', function(){
  document.querySelectorAll('.chip').forEach(c=>{
    c.addEventListener('click', ()=> c.classList.toggle('selected'));
  });
});
