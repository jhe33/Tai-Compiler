A tiny compiler embedded within TSC tries to compile typescript code to C code, and then link
the generated C code to a modified JS runtime like QuickJS. At last feed them to a C compiler, 
gcc or LLVM, we can get a static compiled typescript module.

In this compiler, I plan to emit ts to SSA IR, and based on it, some compiler optimizations will be
implemented, like constant folding, propagation, copy propagation, LVN, GVN and function inline,
even devirtualization etc. Hopefully it can get 3x-5x performance up than QuickJS interpretor.

My previous experiment, a singlepass compiler which only emits C code without any compiler optimization
involved shows C compiler and TSC type inference, could bring 2X performance gain. more optimization
could generate better performance. I choose some cost effective optimizations.




