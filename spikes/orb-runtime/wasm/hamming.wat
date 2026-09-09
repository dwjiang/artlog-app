(module
 (type $0 (func (param i32 i32 f64 i32) (result i32)))
 (memory $0 2 2)
 (export "match" (func $wasm/hamming/match))
 (export "memory" (memory $0))
 (func $wasm/hamming/match (param $0 i32) (param $1 i32) (param $2 f64) (param $3 i32) (result i32)
  (local $4 i32)
  (local $5 i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 i32)
  (local $10 i32)
  (local $11 i32)
  local.get $0
  i32.const 0
  i32.lt_s
  local.get $0
  i32.const 1000
  i32.gt_s
  i32.or
  local.get $1
  i32.const 0
  i32.lt_s
  i32.or
  local.get $1
  i32.const 1000
  i32.gt_s
  i32.or
  if
   unreachable
  end
  loop $for-loop|0
   local.get $0
   local.get $10
   i32.gt_s
   if
    i32.const 257
    local.set $5
    i32.const 257
    local.set $6
    i32.const -1
    local.set $9
    i32.const 0
    local.set $8
    loop $for-loop|1
     local.get $1
     local.get $8
     i32.gt_s
     if
      i32.const 0
      local.set $7
      i32.const 0
      local.set $11
      loop $for-loop|2
       local.get $11
       i32.const 8
       i32.lt_s
       if
        local.get $7
        local.get $11
        i32.const 2
        i32.shl
        local.tee $7
        local.get $10
        i32.const 5
        i32.shl
        i32.add
        i32.load
        local.get $8
        i32.const 5
        i32.shl
        i32.const 32000
        i32.add
        local.get $7
        i32.add
        i32.load
        i32.xor
        i32.popcnt
        i32.add
        local.set $7
        local.get $11
        i32.const 1
        i32.add
        local.set $11
        br $for-loop|2
       end
      end
      local.get $5
      local.get $7
      i32.gt_s
      if
       local.get $5
       local.set $6
       local.get $7
       local.set $5
       local.get $8
       local.set $9
      else
       local.get $7
       local.get $6
       local.get $6
       local.get $7
       i32.gt_s
       select
       local.set $6
      end
      local.get $8
      i32.const 1
      i32.add
      local.set $8
      br $for-loop|1
     end
    end
    local.get $3
    local.get $5
    i32.ge_s
    local.get $9
    i32.const 0
    i32.ge_s
    i32.and
    if (result i32)
     local.get $5
     f64.convert_i32_s
     local.get $2
     local.get $6
     f64.convert_i32_s
     f64.mul
     f64.lt
    else
     i32.const 0
    end
    if
     local.get $4
     i32.const 12
     i32.mul
     i32.const 64000
     i32.add
     local.tee $6
     local.get $10
     i32.store
     local.get $6
     i32.const 4
     i32.add
     local.get $9
     i32.store
     local.get $6
     i32.const 8
     i32.add
     local.get $5
     i32.store
     local.get $4
     i32.const 1
     i32.add
     local.set $4
    end
    local.get $10
    i32.const 1
    i32.add
    local.set $10
    br $for-loop|0
   end
  end
  local.get $4
 )
)
