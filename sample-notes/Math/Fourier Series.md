# Fourier Series

Any periodic function with period $2\pi$ can be written as

$$
f(x) = \frac{a_0}{2} + \sum_{n=1}^{\infty} \left( a_n \cos nx + b_n \sin nx \right)
$$

where the coefficients are

$$
a_n = \frac{1}{\pi}\int_{-\pi}^{\pi} f(x)\cos nx\,dx, \qquad b_n = \frac{1}{\pi}\int_{-\pi}^{\pi} f(x)\sin nx\,dx
$$

## Square wave

For a square wave, only odd sine terms survive:

$$
f(x) = \frac{4}{\pi}\sum_{k=0}^{\infty} \frac{\sin\big((2k+1)x\big)}{2k+1}
$$

The partial sums overshoot near jumps by about $9\%$ — the **Gibbs phenomenon**.
