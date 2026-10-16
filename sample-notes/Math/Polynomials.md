# Formulas and Theory

SimpleMD renders LaTeX math with KaTeX — inline with `$...$` and display blocks with `$$...$$`.

## 1. Definition and Degree of a Polynomial

A polynomial (in one variable $x$) is an expression of the form

$$ P_n(x) = a_n x^n + a_{n-1} x^{n-1} + \cdots + a_1 x + a_0, $$

where $a_0, a_1, \dots, a_n$ are the **coefficients**, and the non-negative integer $n$ is the **degree of the polynomial**, denoted $\deg P$, provided the leading coefficient $a_n \neq 0$.

## 2. Polynomial Division

For any two polynomials $P(x)$ and $Q(x) \neq 0$ there exist unique polynomials $S(x)$ (the quotient) and $R(x)$ (the remainder) such that

$$ P(x) = Q(x) \cdot S(x) + R(x), \qquad \deg R < \deg Q. $$

## 3. The Quadratic Formula

The roots of a second-degree polynomial $ax^2 + bx + c$ (for $a \neq 0$) are given by

$$ x_{1,2} = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}. $$

The discriminant $D = b^2 - 4ac$ determines the nature of the roots: for $D > 0$ two distinct real roots, for $D = 0$ one repeated root, and for $D < 0$ a pair of complex conjugates.

## 4. Sums and Sequences

$$ \sum_{k=1}^{n} k = \frac{n(n+1)}{2}, \qquad \sum_{k=0}^{n} \binom{n}{k} = 2^n. $$

A limit worth remembering: $\lim\limits_{n \to \infty} \left(1 + \frac{1}{n}\right)^n = e.$
